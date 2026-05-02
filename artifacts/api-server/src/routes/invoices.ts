import { Router } from "express";
import { db } from "@workspace/db";
import { invoicesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  ListInvoicesQueryParams,
  CreateInvoiceBody,
  GetInvoiceParams,
  DeleteInvoiceParams,
} from "@workspace/api-zod";
import { z } from "zod";

const router = Router();

const PatchInvoiceBody = z.object({
  paid: z.boolean().optional(),
  paymentProofUrl: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

router.get("/invoices", async (req, res) => {
  const query = ListInvoicesQueryParams.parse(req.query);
  let rows = await db.select().from(invoicesTable);

  if (query.type) rows = rows.filter((r) => r.type === query.type);
  if (query.from) { const from = new Date(query.from); rows = rows.filter((r) => r.createdAt >= from); }
  if (query.to) { const to = new Date(query.to); to.setHours(23, 59, 59); rows = rows.filter((r) => r.createdAt <= to); }

  return res.json(rows.map(toInvoice));
});

router.post("/invoices", async (req, res) => {
  const body = CreateInvoiceBody.parse(req.body);
  const [row] = await db.insert(invoicesTable).values({
    type: body.type,
    vendorOrCustomer: body.vendorOrCustomer ?? null,
    amount: body.amount != null ? String(body.amount) : null,
    invoiceDate: body.invoiceDate ?? null,
    imageUrl: null,
    paymentProofUrl: null,
    paid: false,
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
  const [row] = await db.update(invoicesTable)
    .set({
      ...(body.paid !== undefined && { paid: body.paid }),
      ...(body.paymentProofUrl !== undefined && { paymentProofUrl: body.paymentProofUrl }),
      ...(body.notes !== undefined && { notes: body.notes }),
    })
    .where(eq(invoicesTable.id, id))
    .returning();
  if (!row) return res.status(404).json({ error: "Not found" });
  return res.json(toInvoice(row));
});

router.delete("/invoices/:id", async (req, res) => {
  const { id } = DeleteInvoiceParams.parse({ id: Number(req.params.id) });
  await db.delete(invoicesTable).where(eq(invoicesTable.id, id));
  return res.status(204).send();
});

function toInvoice(row: typeof invoicesTable.$inferSelect) {
  return {
    id: row.id,
    type: row.type,
    vendorOrCustomer: row.vendorOrCustomer ?? null,
    amount: row.amount != null ? parseFloat(row.amount as string) : null,
    invoiceDate: row.invoiceDate ?? null,
    imageUrl: row.imageUrl ?? null,
    paymentProofUrl: (row as Record<string, unknown>).paymentProofUrl as string | null ?? null,
    paid: (row as Record<string, unknown>).paid as boolean ?? false,
    notes: row.notes ?? null,
    aiExtractedData: row.aiExtractedData ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export { toInvoice };
export default router;
