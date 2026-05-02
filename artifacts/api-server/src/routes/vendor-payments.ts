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

router.get("/vendor-payments", async (_req, res) => {
  const rows = await db.select().from(vendorPaymentsTable).orderBy(vendorPaymentsTable.createdAt);
  return res.json(rows.map(toPayment));
});

router.post("/vendor-payments", async (req, res) => {
  const body = CreateVendorPaymentBody.parse(req.body);
  const [row] = await db.insert(vendorPaymentsTable).values({
    vendorName: body.vendorName,
    amount: String(body.amount),
    paymentDate: body.paymentDate ?? null,
    paymentMethod: body.paymentMethod,
    proofImageUrl: body.proofImageUrl ?? null,
    notes: body.notes ?? null,
    linkedInvoiceId: body.linkedInvoiceId ?? null,
  }).returning();
  return res.status(201).json(toPayment(row));
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
