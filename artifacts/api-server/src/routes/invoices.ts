import { Router } from "express";
import { db } from "@workspace/db";
import { invoicesTable, productsTable, purchasesTable, suppliersTable } from "@workspace/db";
import { eq, ilike, sql } from "drizzle-orm";
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

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown server error";
}

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

// Check duplicate by image hash (exact)
router.get("/invoices/check-duplicate", async (req, res) => {
  const hash = req.query.hash as string;
  if (!hash) return res.json({ duplicate: false });
  const rows = await db.select().from(invoicesTable).where(eq(invoicesTable.imageHash, hash));
  if (rows.length > 0) return res.json({ duplicate: true, confidence: "exact", existingInvoice: toInvoice(rows[0]) });
  return res.json({ duplicate: false });
});

// Content-based duplicate check: vendor name + date + amount + line item count
router.get("/invoices/check-duplicate-content", async (req, res) => {
  const vendor = (req.query.vendor as string ?? "").trim();
  const amount = req.query.amount ? parseFloat(req.query.amount as string) : null;
  const date = (req.query.date as string ?? "").trim();   // YYYY-MM-DD
  const itemCount = req.query.itemCount ? parseInt(req.query.itemCount as string) : null;
  const excludeId = req.query.excludeId ? parseInt(req.query.excludeId as string) : null;

  const all = await db.select().from(invoicesTable);
  const candidates = excludeId ? all.filter((r) => r.id !== excludeId) : all;

  const result = findContentDuplicate(candidates, { vendor, amount, date, itemCount });
  return res.json(result);
});

router.post("/invoices", async (req, res) => {
  try {
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

    // Content-based duplicate check before saving
    const invoiceDateStr = body.invoiceDate instanceof Date
      ? body.invoiceDate.toISOString().split("T")[0]
      : (body.invoiceDate ?? null);
    const existing = await db.select().from(invoicesTable);
    const dupCheck = findContentDuplicate(existing, {
      vendor: body.vendorOrCustomer ?? "",
      amount: body.amount ?? null,
      date: invoiceDateStr ?? "",
      itemCount: extra.lineItems?.length ?? null,
    });

    // Auto-create supplier record if vendor name present
    if (body.vendorOrCustomer?.trim()) {
      await upsertSupplier(body.vendorOrCustomer.trim());
    }

    const [row] = await db.insert(invoicesTable).values({
      type: body.type,
      vendorOrCustomer: body.vendorOrCustomer ?? null,
      amount: body.amount != null ? String(body.amount) : null,
      invoiceDate: invoiceDateStr,
      imageUrl,
      imageHash,
      paymentProofUrl: null,
      paid: false,
      lineItems: extra.lineItems ?? null,
      stockUpdated: false,
      notes: body.notes ?? null,
      aiExtractedData: null,
    }).returning();

    const response = toInvoice(row) as Record<string, unknown>;
    if (dupCheck.duplicate) {
      response.duplicateWarning = {
        confidence: dupCheck.confidence,
        score: dupCheck.score,
        existingInvoice: dupCheck.existingInvoice,
        message: `Possible duplicate (${dupCheck.confidence} confidence, score ${dupCheck.score}/110). Similar invoice already exists.`,
      };
    }
    return res.status(201).json(response);
  } catch (err) {
    logger.error({ err }, "Failed to save invoice");
    return res.status(500).json({ error: "Failed to save invoice", detail: errorMessage(err) });
  }
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

// Auto-upsert supplier by name (case-insensitive). Returns supplier id.
async function upsertSupplier(name: string): Promise<number> {
  const [existing] = await db.select().from(suppliersTable)
    .where(sql`lower(${suppliersTable.name}) = lower(${name})`);
  if (existing) return existing.id;
  const [created] = await db.insert(suppliersTable).values({ name }).returning();
  return created.id;
}

// ── Content-based duplicate detection ────────────────────────────────────────

interface DuplicateCandidate {
  vendor: string;
  amount: number | null;
  date: string;       // YYYY-MM-DD
  itemCount: number | null;
}

function scoreDuplicate(existing: typeof invoicesTable.$inferSelect, candidate: DuplicateCandidate): number {
  let score = 0;

  // Vendor name (40 pts)
  const existingVendor = existing.vendorOrCustomer ?? "";
  if (existingVendor && candidate.vendor) {
    const sim = wordSimilarity(existingVendor, candidate.vendor);
    if (sim >= 0.8) score += 40;
    else if (sim >= 0.5) score += 25;
    else if (sim >= 0.3) score += 10;
  }

  // Amount (40 pts)
  const existingAmt = existing.amount ? parseFloat(existing.amount as string) : null;
  if (existingAmt != null && candidate.amount != null) {
    const diff = Math.abs(existingAmt - candidate.amount);
    const pct = existingAmt > 0 ? diff / existingAmt : diff;
    if (pct === 0) score += 40;
    else if (pct <= 0.01) score += 35;  // within 1%
    else if (pct <= 0.05) score += 20;  // within 5%
  }

  // Date (20 pts)
  if (existing.invoiceDate && candidate.date) {
    const d1 = new Date(existing.invoiceDate).getTime();
    const d2 = new Date(candidate.date).getTime();
    const daysDiff = Math.abs(d1 - d2) / 86_400_000;
    if (daysDiff === 0) score += 20;
    else if (daysDiff <= 2) score += 10;
  }

  // Line item count bonus (10 pts)
  const existingItems = existing.lineItems as unknown[] | null;
  const existingCount = existingItems?.length ?? null;
  if (existingCount != null && candidate.itemCount != null && existingCount === candidate.itemCount) {
    score += 10;
  }

  return score;
}

function findContentDuplicate(
  rows: (typeof invoicesTable.$inferSelect)[],
  candidate: DuplicateCandidate,
): { duplicate: boolean; confidence: string; score: number; existingInvoice: ReturnType<typeof toInvoice> | null } {
  let best: typeof rows[0] | null = null;
  let bestScore = 0;

  for (const row of rows) {
    const s = scoreDuplicate(row, candidate);
    if (s > bestScore) { best = row; bestScore = s; }
  }

  if (bestScore >= 75) return { duplicate: true, confidence: "high", score: bestScore, existingInvoice: toInvoice(best!) };
  if (bestScore >= 50) return { duplicate: true, confidence: "medium", score: bestScore, existingInvoice: toInvoice(best!) };
  return { duplicate: false, confidence: "none", score: bestScore, existingInvoice: null };
}

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
  const results: { name: string; matched: boolean; created?: boolean; productId?: number }[] = [];

  for (const item of lineItems) {
    const quantity = Math.max(0, Math.round(Number(item.quantity) || 0));
    const unitPrice = Number(item.unitPrice) || 0;
    const match = bestProductMatch(item.name, allProducts);
    if (match) {
      await db.update(productsTable).set({
        stockQuantity: match.stockQuantity + quantity,
        costPrice: unitPrice > 0 ? String(unitPrice) : match.costPrice,
        updatedAt: new Date(),
      }).where(eq(productsTable.id, match.id));
      results.push({ name: item.name, matched: true, productId: match.id });
    } else {
      const [created] = await db.insert(productsTable).values({
        name: item.name.trim(),
        description: "Created from scanned invoice",
        costPrice: String(unitPrice),
        sellingPrice: String(unitPrice),
        stockQuantity: quantity,
        lowStockThreshold: 5,
        unit: "pcs",
        gstRate: 0,
      }).returning();
      if (created) allProducts.push(created);
      results.push({ name: item.name, matched: true, created: true, productId: created?.id });
    }
  }

  await db.update(invoicesTable).set({ stockUpdated: true } as Record<string, unknown>).where(eq(invoicesTable.id, id));

  // Auto-create a Purchase record so the transaction appears on the Purchases page
  const vendorName = invoice.vendorOrCustomer ?? "Unknown Vendor";

  // Upsert supplier so it appears in the Suppliers list
  const supplierId = vendorName !== "Unknown Vendor"
    ? await upsertSupplier(vendorName)
    : null;

  const purchaseItems = lineItems.map((item, i) => {
    const r = results[i];
    return {
      productId: r?.productId ?? null,
      productName: item.name,
      quantity: Number(item.quantity) || 0,
      unitPrice: Number(item.unitPrice) || 0,
      subtotal: (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0),
    };
  });
  const purchaseTotal = purchaseItems.reduce((s, i) => s + i.subtotal, 0);
  await db.insert(purchasesTable).values({
    vendorName,
    supplierId,
    purchaseDate: invoice.invoiceDate ?? null,
    notes: `From scanned invoice #${invoice.id}`,
    items: purchaseItems,
    totalAmount: String(purchaseTotal),
  });

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
