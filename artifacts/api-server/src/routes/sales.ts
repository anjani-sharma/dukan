import { Router } from "express";
import { db } from "@workspace/db";
import { salesTable, customersTable, productsTable, stockMovementsTable } from "@workspace/db";
import { eq, and, gte, lte, sql, desc } from "drizzle-orm";
import {
  ListSalesQueryParams,
  CreateSaleBody,
  GetSaleParams,
  DeleteSaleParams,
} from "@workspace/api-zod";

const router = Router();

router.get("/sales", async (req, res) => {
  const query = ListSalesQueryParams.parse(req.query);
  let rows = await db.select().from(salesTable);

  if (query.customerId) {
    rows = rows.filter((r) => r.customerId === query.customerId);
  }
  if (query.from) {
    const from = new Date(query.from);
    rows = rows.filter((r) => r.createdAt >= from);
  }
  if (query.to) {
    const to = new Date(query.to);
    to.setHours(23, 59, 59);
    rows = rows.filter((r) => r.createdAt <= to);
  }

  const customers = await db.select().from(customersTable);
  const customerMap = new Map(customers.map((c) => [c.id, c.name]));

  return res.json(rows.map((r) => toSaleResponse(r, customerMap)));
});

// Duplicate check endpoint for sales
router.get("/sales/check-duplicate", async (req, res) => {
  const customerId = req.query.customerId ? Number(req.query.customerId) : null;
  const totalAmount = req.query.totalAmount ? parseFloat(req.query.totalAmount as string) : null;
  if (totalAmount == null) return res.json({ duplicate: false });
  const windowMs = 30 * 1000; // 30 seconds
  const since = new Date(Date.now() - windowMs);
  const rows = await db.select().from(salesTable)
    .where(and(gte(salesTable.createdAt, since)))
    .orderBy(desc(salesTable.createdAt))
    .limit(10);
  const match = rows.find((r) => {
    const sameTotal = Math.abs(parseFloat(r.totalAmount as string) - totalAmount) < 0.01;
    const sameCustomer = customerId ? r.customerId === customerId : r.customerId == null;
    return sameTotal && sameCustomer;
  });
  if (match) return res.json({ duplicate: true, existingSale: toSaleResponse(match, new Map()) });
  return res.json({ duplicate: false });
});

router.post("/sales", async (req, res) => {
  const body = CreateSaleBody.parse(req.body);
  const items = body.items;
  const totalAmount = items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
  const creditAmount = Math.max(0, totalAmount - body.paidAmount);

  const enrichedItems = items.map((i) => ({
    productId: i.productId ?? null,
    productName: i.productName,
    quantity: i.quantity,
    unitPrice: i.unitPrice,
    subtotal: i.quantity * i.unitPrice,
  }));

  const [sale] = await db.insert(salesTable).values({
    customerId: body.customerId ?? null,
    items: enrichedItems,
    totalAmount: String(totalAmount),
    paidAmount: String(body.paidAmount),
    creditAmount: String(creditAmount),
    notes: body.notes ?? null,
    source: body.source ?? "web",
    paymentMode: (body as { paymentMode?: string }).paymentMode ?? "cash",
  }).returning();

  // Deduct stock — first by productId, then by name-matching for items without ID
  const allProducts = await db.select().from(productsTable);
  const productsByName = new Map(allProducts.map((p) => [p.name.toLowerCase(), p]));

  for (const item of items) {
    const matchedProduct = item.productId
      ? allProducts.find((p) => p.id === item.productId)
      : productsByName.get(item.productName.toLowerCase());
    const pid = matchedProduct?.id ?? null;
    if (pid) {
      await db.update(productsTable)
        .set({ stockQuantity: sql`GREATEST(0, ${productsTable.stockQuantity} - ${item.quantity})` })
        .where(eq(productsTable.id, pid));
    }
    await db.insert(stockMovementsTable).values({
      productId: pid,
      productName: matchedProduct?.name ?? item.productName,
      movementType: "sale",
      qtyChange: String(-item.quantity),
      referenceId: sale.id,
      referenceType: "sale",
    });
  }

  return res.status(201).json(toSaleResponse(sale, new Map()));
});

router.get("/sales/:id", async (req, res) => {
  const { id } = GetSaleParams.parse({ id: Number(req.params.id) });
  const [row] = await db.select().from(salesTable).where(eq(salesTable.id, id));
  if (!row) return res.status(404).json({ error: "Not found" });
  const customers = await db.select().from(customersTable);
  const customerMap = new Map(customers.map((c) => [c.id, c.name]));
  return res.json(toSaleResponse(row, customerMap));
});

router.delete("/sales/:id", async (req, res) => {
  const { id } = DeleteSaleParams.parse({ id: Number(req.params.id) });
  await db.delete(salesTable).where(eq(salesTable.id, id));
  return res.status(204).send();
});

export function toSaleResponse(
  row: typeof salesTable.$inferSelect,
  customerMap: Map<number, string>,
) {
  return {
    id: row.id,
    customerId: row.customerId ?? null,
    customerName: row.customerId ? (customerMap.get(row.customerId) ?? null) : null,
    items: row.items as object[],
    totalAmount: parseFloat(row.totalAmount as string),
    paidAmount: parseFloat(row.paidAmount as string),
    creditAmount: parseFloat(row.creditAmount as string),
    notes: row.notes ?? null,
    source: row.source,
    paymentMode: row.paymentMode ?? "cash",
    createdAt: row.createdAt.toISOString(),
  };
}

export default router;
