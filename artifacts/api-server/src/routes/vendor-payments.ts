import { Router } from "express";
import { db } from "@workspace/db";
import { vendorPaymentsTable, invoicesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

const router = Router();

const CreateVendorPaymentBody = z.object({
  vendorName: z.string().min(1),
  amount: z.number().positive(),
  paymentDate: z.string().optional().nullable(),
  paymentMethod: z.enum(["cash", "bank", "gpay", "upi", "cheque"]).default("cash"),
  proofImageUrl: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  linkedInvoiceId: z.number().int().optional().nullable(),
});

// Word-overlap similarity
function wordSim(a: string, b: string): number {
  const tok = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9]/g, " ").split(/\s+/).filter(Boolean));
  const ta = tok(a); const tb = tok(b);
  let common = 0; for (const w of ta) if (tb.has(w)) common++;
  const union = new Set([...ta, ...tb]).size;
  return union === 0 ? 0 : common / union;
}

function findPaymentDuplicate(
  rows: (typeof vendorPaymentsTable.$inferSelect)[],
  vendor: string,
  amount: number,
  date: string | null,
  method: string,
): { duplicate: boolean; confidence: string; score: number; existingPayment: ReturnType<typeof toPayment> | null } {
  let best: typeof rows[0] | null = null;
  let bestScore = 0;

  for (const row of rows) {
    let score = 0;

    // Vendor name (40 pts)
    const sim = wordSim(row.vendorName, vendor);
    if (sim >= 0.8) score += 40;
    else if (sim >= 0.5) score += 25;
    else if (sim >= 0.3) score += 10;

    // Amount (40 pts)
    const rowAmt = parseFloat(row.amount as string);
    const diff = Math.abs(rowAmt - amount);
    const pct = rowAmt > 0 ? diff / rowAmt : diff;
    if (pct === 0) score += 40;
    else if (pct <= 0.01) score += 35;
    else if (pct <= 0.05) score += 20;

    // Date (15 pts)
    if (row.paymentDate && date) {
      const daysDiff = Math.abs(new Date(row.paymentDate).getTime() - new Date(date).getTime()) / 86_400_000;
      if (daysDiff === 0) score += 15;
      else if (daysDiff <= 2) score += 7;
    }

    // Payment method (5 pts)
    if (row.paymentMethod === method) score += 5;

    if (score > bestScore) { best = row; bestScore = score; }
  }

  if (bestScore >= 75) return { duplicate: true, confidence: "high", score: bestScore, existingPayment: toPayment(best!) };
  if (bestScore >= 50) return { duplicate: true, confidence: "medium", score: bestScore, existingPayment: toPayment(best!) };
  return { duplicate: false, confidence: "none", score: bestScore, existingPayment: null };
}

router.get("/vendor-payments", async (_req, res) => {
  const rows = await db.select().from(vendorPaymentsTable).orderBy(vendorPaymentsTable.createdAt);
  return res.json(rows.map(toPayment));
});

// Content-based duplicate check endpoint
router.get("/vendor-payments/check-duplicate", async (req, res) => {
  const vendor = (req.query.vendor as string ?? "").trim();
  const amount = req.query.amount ? parseFloat(req.query.amount as string) : null;
  const date = (req.query.date as string ?? null);
  const method = (req.query.method as string ?? "cash");
  const excludeId = req.query.excludeId ? parseInt(req.query.excludeId as string) : null;

  if (!vendor || amount == null) return res.json({ duplicate: false, confidence: "none", score: 0, existingPayment: null });

  const all = await db.select().from(vendorPaymentsTable);
  const candidates = excludeId ? all.filter((r) => r.id !== excludeId) : all;
  return res.json(findPaymentDuplicate(candidates, vendor, amount, date, method));
});

router.post("/vendor-payments", async (req, res) => {
  const body = CreateVendorPaymentBody.parse(req.body);

  // Content-based duplicate check
  const existing = await db.select().from(vendorPaymentsTable);
  const dupCheck = findPaymentDuplicate(existing, body.vendorName, body.amount, body.paymentDate ?? null, body.paymentMethod);

  const [row] = await db.insert(vendorPaymentsTable).values({
    vendorName: body.vendorName,
    amount: String(body.amount),
    paymentDate: body.paymentDate ?? null,
    paymentMethod: body.paymentMethod,
    proofImageUrl: body.proofImageUrl ?? null,
    notes: body.notes ?? null,
    linkedInvoiceId: body.linkedInvoiceId ?? null,
  }).returning();

  const response = toPayment(row) as Record<string, unknown>;
  if (dupCheck.duplicate) {
    response.duplicateWarning = {
      confidence: dupCheck.confidence,
      score: dupCheck.score,
      existingPayment: dupCheck.existingPayment,
      message: `Possible duplicate payment (${dupCheck.confidence} confidence). Similar payment already recorded.`,
    };
  }
  return res.status(201).json(response);
});

router.patch("/vendor-payments/:id", async (req, res) => {
  const id = Number(req.params.id);
  const body = CreateVendorPaymentBody.partial().parse(req.body);
  const updates: Record<string, unknown> = {};
  if (body.vendorName !== undefined) updates.vendorName = body.vendorName;
  if (body.amount !== undefined) updates.amount = String(body.amount);
  if (body.paymentDate !== undefined) updates.paymentDate = body.paymentDate;
  if (body.paymentMethod !== undefined) updates.paymentMethod = body.paymentMethod;
  if (body.proofImageUrl !== undefined) updates.proofImageUrl = body.proofImageUrl;
  if (body.notes !== undefined) updates.notes = body.notes;
  if (body.linkedInvoiceId !== undefined) updates.linkedInvoiceId = body.linkedInvoiceId;
  const [row] = await db.update(vendorPaymentsTable).set(updates).where(eq(vendorPaymentsTable.id, id)).returning();
  if (!row) return res.status(404).json({ error: "Not found" });
  return res.json(toPayment(row));
});

router.delete("/vendor-payments/:id", async (req, res) => {
  await db.delete(vendorPaymentsTable).where(eq(vendorPaymentsTable.id, Number(req.params.id)));
  return res.status(204).send();
});

// Per-vendor ledger summary
router.get("/vendor-payments/summary", async (_req, res) => {
  const [allPayments, allInvoices] = await Promise.all([
    db.select().from(vendorPaymentsTable),
    db.select().from(invoicesTable),
  ]);

  const purchaseInvoices = allInvoices.filter((inv) => inv.type === "purchase");

  // Collect all vendor names from both tables
  const vendorSet = new Set<string>();
  purchaseInvoices.forEach((inv) => { if (inv.vendorOrCustomer) vendorSet.add(inv.vendorOrCustomer); });
  allPayments.forEach((p) => vendorSet.add(p.vendorName));

  const summary = Array.from(vendorSet).map((vendor) => {
    const invoices = purchaseInvoices.filter((inv) => inv.vendorOrCustomer === vendor);
    const payments = allPayments.filter((p) => p.vendorName === vendor);
    const totalBilled = invoices.reduce((s, inv) => s + (inv.amount ? parseFloat(inv.amount as string) : 0), 0);
    const totalPaid = payments.reduce((s, p) => s + parseFloat(p.amount as string), 0);
    return {
      vendorName: vendor,
      totalBilled,
      totalPaid,
      outstanding: Math.max(0, totalBilled - totalPaid),
      invoiceCount: invoices.length,
      paymentCount: payments.length,
      lastPayment: payments.length > 0 ? payments[payments.length - 1].createdAt.toISOString() : null,
    };
  }).sort((a, b) => b.outstanding - a.outstanding);

  return res.json(summary);
});

function toPayment(row: typeof vendorPaymentsTable.$inferSelect) {
  return {
    id: row.id,
    vendorName: row.vendorName,
    amount: parseFloat(row.amount as string),
    paymentDate: row.paymentDate ?? null,
    paymentMethod: row.paymentMethod,
    proofImageUrl: row.proofImageUrl ?? null,
    notes: row.notes ?? null,
    linkedInvoiceId: row.linkedInvoiceId ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export default router;
