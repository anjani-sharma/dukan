import { Router } from "express";
import { db } from "@workspace/db";
import { returnsTable, productsTable, customersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const router = Router();

router.get("/returns", async (_req, res) => {
  const rows = await db.select().from(returnsTable).orderBy(sql`${returnsTable.createdAt} DESC`);
  const customers = await db.select().from(customersTable);
  const cMap = new Map(customers.map((c) => [c.id, c.name]));
  return res.json(rows.map((r) => toReturn(r, cMap)));
});

router.post("/returns", async (req, res) => {
  const body = req.body as {
    saleId?: number | null;
    customerId?: number | null;
    reason?: string | null;
    refundMode?: string;
    items: { productId?: number | null; productName: string; quantity: number; unitPrice: number }[];
  };

  const items = (body.items ?? []).map((i) => ({
    productId: i.productId ?? null,
    productName: i.productName,
    quantity: i.quantity,
    unitPrice: i.unitPrice,
    subtotal: i.quantity * i.unitPrice,
  }));
  const totalAmount = items.reduce((s, i) => s + i.subtotal, 0);

  const [row] = await db.insert(returnsTable).values({
    saleId: body.saleId ?? null,
    customerId: body.customerId ?? null,
    reason: body.reason ?? null,
    refundMode: body.refundMode ?? "cash",
    items,
    totalAmount: String(totalAmount),
  }).returning();

  // Restore stock for returned items
  const allProducts = await db.select().from(productsTable);
  const byName = new Map(allProducts.map((p) => [p.name.toLowerCase(), p]));
  for (const item of items) {
    const pid = item.productId ?? byName.get(item.productName.toLowerCase())?.id ?? null;
    if (pid) {
      await db.update(productsTable)
        .set({ stockQuantity: sql`${productsTable.stockQuantity} + ${item.quantity}` })
        .where(eq(productsTable.id, pid));
    }
  }

  const customers = await db.select().from(customersTable);
  const cMap = new Map(customers.map((c) => [c.id, c.name]));
  return res.status(201).json(toReturn(row, cMap));
});

router.delete("/returns/:id", async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(returnsTable).where(eq(returnsTable.id, id));
  return res.status(204).send();
});

function toReturn(row: typeof returnsTable.$inferSelect, cMap: Map<number, string>) {
  return {
    id: row.id,
    saleId: row.saleId ?? null,
    customerId: row.customerId ?? null,
    customerName: row.customerId ? (cMap.get(row.customerId) ?? null) : null,
    reason: row.reason ?? null,
    refundMode: row.refundMode,
    items: row.items as object[],
    totalAmount: parseFloat(row.totalAmount as string),
    createdAt: row.createdAt.toISOString(),
  };
}

export default router;
