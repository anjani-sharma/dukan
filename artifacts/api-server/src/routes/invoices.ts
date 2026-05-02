import { Router } from "express";
import { db } from "@workspace/db";
import { invoicesTable, productsTable } from "@workspace/db";
import { eq, ilike } from "drizzle-orm";
import {
  ListInvoicesQueryParams,
  CreateInvoiceBody,
  GetInvoiceParams,
  DeleteInvoiceParams,
} from "@workspace/api-zod";
import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { uploadToR2, deleteFromR2, keyFromUrl } from "../lib/r2";
import { logger } from "../lib/logger";

const router = Router();

const PatchInvoiceBody = z.object({
  paid: z.boolean().optional(),
  paymentProofUrl: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  stockUpdated: z.boolean().optional(),
  lineItems: z.array(z.object({
    name: z.string(),
    quantity: z.number(),
    unitPrice: z.number(),
    subtotal: z.number(),
  })).nullable().optional(),
});

router.get("/invoices", async (req, res) => {
  const query = ListInvoicesQueryParams.parse(req.query);
  let rows = await db.select().from(invoicesTable);
  if (query.type) rows = rows.filter((r) => r.type === query.type);
  if (query.from) { const from = new Date(query.from); rows = rows.filter((r) => r.createdAt >= from); }
  if (query.to) { const to = new Date(query.to); to.setHours(23, 59, 59); rows = rows.filter((r) => r.createdAt <= to); }
  return res.json(rows.map(toInvoice));
});

// Check duplicate by image hash
router.get("/invoices/check-duplicate", async (req, res) => {
  const hash = req.query.hash as string;
  if (!hash) return res.json({ duplicate: false });
  const rows = await db.select().from(invoicesTable).where(eq(invoicesTable.imageHash, hash));
  if (rows.length > 0) {
    return res.json({ duplicate: true, existingInvoice: toInvoice(rows[0]) });
  }
  return res.json({ duplicate: false });
});

router.post("/invoices", async (req, res) => {
  const body = CreateInvoiceBody.parse(req.body);
  const extra = req.body as {
    imageBase64?: string;
    lineItems?: { name: string; quantity: number; unitPrice: number; subtotal: number }[];
  };

  // Compute hash if image provided
  let imageHash: string | null = null;
  let imageUrl: string | null = null;
  if (extra.imageBase64) {
    imageHash = createHash("sha256").update(extra.imageBase64).digest("hex");
    const mimeType = req.body.mimeType ?? "image/jpeg";
    const ext = mimeType.split("/")[1] ?? "jpg";
    const key = `invoices/${randomUUID()}.${ext}`;
    const buffer = Buffer.from(extra.imageBase64, "base64");
    let r2Url: string | null = null;
    try {
      r2Url = await uploadToR2(buffer, key, mimeType);
    } catch (err) {
      logger.warn({ err }, "Failed to upload invoice image to R2; saving invoice with embedded image");
    }
    // Use R2 URL if available, otherwise fall back to base64 data URL
    imageUrl = r2Url ?? `data:${mimeType};base64,${extra.imageBase64}`;
  }

  const [row] = await db.insert(invoicesTable).values({
    type: body.type,
    vendorOrCustomer: body.vendorOrCustomer ?? null,
    amount: body.amount != null ? String(body.amount) : null,
    invoiceDate: body.invoiceDate instanceof Date ? body.invoiceDate.toISOString().split("T")[0] : (body.invoiceDate ?? null),
    imageUrl,
    imageHash,
    paymentProofUrl: null,
    paid: false,
    lineItems: extra.lineItems ?? null,
    stockUpdated: false,
    notes: body.notes ?? null,
    aiExtractedData: null,
  }).returning();
  return res.status(201).json(toInvoice(row));
});

router.get("/invoices/:id", async (req, res) => {
  const { id } = GetInvoiceParams.parse({ id: Number(req.params.id) });
  const [row] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id));
  if (!row) return res.status(404).json({ error: "Not found" });
  return res.json(toInvoice(row));
});

router.patch("/invoices/:id", async (req, res) => {
  const id = Number(req.params.id);
  const body = PatchInvoiceBody.parse(req.body);
  const updates: Record<string, unknown> = {};
  if (body.paid !== undefined) updates.paid = body.paid;
  if (body.paymentProofUrl !== undefined) updates.paymentProofUrl = body.paymentProofUrl;
  if (body.notes !== undefined) updates.notes = body.notes;
  if (body.stockUpdated !== undefined) updates.stockUpdated = body.stockUpdated;
  if (body.lineItems !== undefined) updates.lineItems = body.lineItems;
  const [row] = await db.update(invoicesTable).set(updates).where(eq(invoicesTable.id, id)).returning();
  if (!row) return res.status(404).json({ error: "Not found" });
  return res.json(toInvoice(row));
});

// Word-overlap similarity: tokenise both names and compute Jaccard score
function wordSimilarity(a: string, b: string): number {
  const tok = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9.]/g, " ").split(/\s+/).filter(Boolean));
  const ta = tok(a);
  const tb = tok(b);
  let common = 0;
  for (const w of ta) if (tb.has(w)) common++;
  const union = new Set([...ta, ...tb]).size;
  return union === 0 ? 0 : common / union;
}

function bestProductMatch(name: string, products: (typeof productsTable.$inferSelect)[]) {
  const lower = name.toLowerCase().trim();
  // 1. Exact
  const exact = products.find((p) => p.name.toLowerCase() === lower);
  if (exact) return exact;
  // 2. Substring contains
  const sub = products.find((p) => p.name.toLowerCase().includes(lower) || lower.includes(p.name.toLowerCase()));
  if (sub) return sub;
  // 3. Word-overlap (Jaccard ≥ 0.35)
  let best: (typeof productsTable.$inferSelect) | null = null;
  let bestScore = 0.35;
  for (const p of products) {
    const score = wordSimilarity(p.name, name);
    if (score > bestScore) { best = p; bestScore = score; }
  }
  return best ?? null;
}

// Apply line items to stock (increase product quantities)
router.post("/invoices/:id/apply-stock", async (req, res) => {
  const id = Number(req.params.id);
  const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id));
  if (!invoice) return res.status(404).json({ error: "Not found" });
  if ((invoice as Record<string, unknown>).stockUpdated) return res.status(400).json({ error: "Stock already updated for this invoice" });

  const lineItems = invoice.lineItems as { name: string; quantity: number; unitPrice: number }[] | null;
  if (!lineItems || lineItems.length === 0) return res.status(400).json({ error: "No line items on this invoice" });

  const allProducts = await db.select().from(productsTable);
  const results: { name: string; matched: boolean; productId?: number }[] = [];

  for (const item of lineItems) {
    const match = bestProductMatch(item.name, allProducts);
    if (match) {
      await db.update(productsTable).set({
        stockQuantity: match.stockQuantity + Math.round(item.quantity),
        updatedAt: new Date(),
      }).where(eq(productsTable.id, match.id));
      results.push({ name: item.name, matched: true, productId: match.id });
    } else {
      results.push({ name: item.name, matched: false });
    }
  }

  await db.update(invoicesTable).set({ stockUpdated: true } as Record<string, unknown>).where(eq(invoicesTable.id, id));
  return res.json({ ok: true, results });
});

router.delete("/invoices/:id", async (req, res) => {
  const { id } = DeleteInvoiceParams.parse({ id: Number(req.params.id) });
  const [row] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id));
  if (row?.imageUrl) {
    const key = keyFromUrl(row.imageUrl);
    if (key) await deleteFromR2(key);
  }
  await db.delete(invoicesTable).where(eq(invoicesTable.id, id));
  return res.status(204).send();
});

function toInvoice(row: typeof invoicesTable.$inferSelect) {
  const r = row as Record<string, unknown>;
  return {
    id: row.id,
    type: row.type,
    vendorOrCustomer: row.vendorOrCustomer ?? null,
    amount: row.amount != null ? parseFloat(row.amount as string) : null,
    invoiceDate: row.invoiceDate ?? null,
    imageUrl: row.imageUrl ?? null,
    imageHash: r.imageHash as string | null ?? null,
    paymentProofUrl: r.paymentProofUrl as string | null ?? null,
    paid: r.paid as boolean ?? false,
    lineItems: r.lineItems ?? null,
    stockUpdated: r.stockUpdated as boolean ?? false,
    notes: row.notes ?? null,
    aiExtractedData: row.aiExtractedData ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export { toInvoice };
export default router;
