import { Router } from "express";
import { db } from "@workspace/db";
import { customersTable, creditPaymentsTable, salesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import {
  ListCustomersQueryParams,
  CreateCustomerBody,
  GetCustomerParams,
  UpdateCustomerParams,
  UpdateCustomerBody,
  DeleteCustomerParams,
  ListCustomerPaymentsParams,
  RecordPaymentParams,
  RecordPaymentBody,
} from "@workspace/api-zod";

const router = Router();

router.get("/customers", async (req, res) => {
  const query = ListCustomersQueryParams.parse(req.query);
  const rows = await db.select().from(customersTable);
  const salesRows = await db.select().from(salesTable);
  const paymentsRows = await db.select().from(creditPaymentsTable);

  let customers = rows.map((c) => enrichCustomer(c, salesRows, paymentsRows));
  if (query.search) {
    const s = query.search.toLowerCase();
    customers = customers.filter((c) => c.name.toLowerCase().includes(s));
  }
  if (query.hasBalance) {
    customers = customers.filter((c) => c.outstandingBalance > 0);
  }
  return res.json(customers);
});

router.post("/customers", async (req, res) => {
  const body = CreateCustomerBody.parse(req.body);
  const [row] = await db.insert(customersTable).values({
    name: body.name,
    phone: body.phone ?? null,
    email: body.email ?? null,
    address: body.address ?? null,
  }).returning();
  const payments: typeof creditPaymentsTable.$inferSelect[] = [];
  const sales: typeof salesTable.$inferSelect[] = [];
  return res.status(201).json(enrichCustomer(row, sales, payments));
});

router.get("/customers/:id", async (req, res) => {
  const { id } = GetCustomerParams.parse({ id: Number(req.params.id) });
  const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, id));
  if (!customer) return res.status(404).json({ error: "Not found" });
  const sales = await db.select().from(salesTable).where(eq(salesTable.customerId, id));
  const payments = await db.select().from(creditPaymentsTable).where(eq(creditPaymentsTable.customerId, id));
  const base = enrichCustomer(customer, sales, payments);
  return res.json({
    ...base,
    sales: sales.map(toSale),
    payments: payments.map(toPayment),
  });
});

router.put("/customers/:id", async (req, res) => {
  const { id } = UpdateCustomerParams.parse({ id: Number(req.params.id) });
  const body = UpdateCustomerBody.parse(req.body);
  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.phone !== undefined) updates.phone = body.phone;
  if (body.email !== undefined) updates.email = body.email;
  if (body.address !== undefined) updates.address = body.address;
  const [row] = await db.update(customersTable).set(updates).where(eq(customersTable.id, id)).returning();
  if (!row) return res.status(404).json({ error: "Not found" });
  const payments = await db.select().from(creditPaymentsTable).where(eq(creditPaymentsTable.customerId, id));
  const sales = await db.select().from(salesTable).where(eq(salesTable.customerId, id));
  return res.json(enrichCustomer(row, sales, payments));
});

router.delete("/customers/:id", async (req, res) => {
  const { id } = DeleteCustomerParams.parse({ id: Number(req.params.id) });
  await db.delete(customersTable).where(eq(customersTable.id, id));
  return res.status(204).send();
});

router.get("/customers/:customerId/payments", async (req, res) => {
  const { customerId } = ListCustomerPaymentsParams.parse({ customerId: Number(req.params.customerId) });
  const rows = await db.select().from(creditPaymentsTable).where(eq(creditPaymentsTable.customerId, customerId));
  return res.json(rows.map(toPayment));
});

router.post("/customers/:customerId/payments", async (req, res) => {
  const { customerId } = RecordPaymentParams.parse({ customerId: Number(req.params.customerId) });
  const body = RecordPaymentBody.parse(req.body);
  const [row] = await db.insert(creditPaymentsTable).values({
    customerId,
    amount: String(body.amount),
    notes: body.notes ?? null,
  }).returning();
  return res.status(201).json(toPayment(row));
});

function enrichCustomer(
  customer: typeof customersTable.$inferSelect,
  sales: typeof salesTable.$inferSelect[],
  payments: typeof creditPaymentsTable.$inferSelect[],
) {
  const customerSales = sales.filter((s) => s.customerId === customer.id);
  const customerPayments = payments.filter((p) => p.customerId === customer.id);
  const totalCredit = customerSales.reduce((sum, s) => sum + parseFloat(s.creditAmount as string), 0);
  const totalPaid = customerPayments.reduce((sum, p) => sum + parseFloat(p.amount as string), 0);
  return {
    id: customer.id,
    name: customer.name,
    phone: customer.phone ?? null,
    email: customer.email ?? null,
    address: customer.address ?? null,
    totalCredit,
    totalPaid,
    outstandingBalance: Math.max(0, totalCredit - totalPaid),
    createdAt: customer.createdAt.toISOString(),
  };
}

function toPayment(row: typeof creditPaymentsTable.$inferSelect) {
  return {
    id: row.id,
    customerId: row.customerId,
    amount: parseFloat(row.amount as string),
    notes: row.notes ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function toSale(row: typeof salesTable.$inferSelect) {
  return {
    id: row.id,
    customerId: row.customerId ?? null,
    customerName: null,
    items: row.items as object[],
    totalAmount: parseFloat(row.totalAmount as string),
    paidAmount: parseFloat(row.paidAmount as string),
    creditAmount: parseFloat(row.creditAmount as string),
    notes: row.notes ?? null,
    source: row.source,
    createdAt: row.createdAt.toISOString(),
  };
}

export { toPayment, toSale };
export default router;
