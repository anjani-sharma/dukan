import { Router } from "express";
import { db } from "@workspace/db";
import { purchasesTable, productsTable } from "@workspace/db";
import { eq, ilike, sql } from "drizzle-orm";

const router = Router();

router.get("/purchases", async (_req, res) => {
  const rows = await db.select().from(purchasesTable).orderBy(sql`${purchasesTable.createdAt} DESC`);
  return res.json(rows.map(toPurchase));
});

router.post("/purchases", async (req, res) => {
  const body = req.body as {
    vendorName: string;
    purchaseDate?: string | null;
    notes?: string | null;
    items: { productId?: number | null; productName: string; quantity: number; unitPrice: number }[];
    applyStock?: boolean;
  };

  const items = (body.items ?? []).map((i) => ({
    productId: i.productId ?? null,
    productName: i.productName,
    quantity: i.quantity,
    unitPrice: i.unitPrice,
    subtotal: i.quantity * i.unitPrice,
  }));
  const totalAmount = items.reduce((s, i) => s + i.subtotal, 0);

  const [row] = await db.insert(purchasesTable).values({
    vendorName: body.vendorName,
    purchaseDate: body.purchaseDate ?? null,
    notes: body.notes ?? null,
    items,
    totalAmount: String(totalAmount),
  }).returning();

  // Auto-increment stock for matched products
  if (body.applyStock !== false) {
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
  }

  return res.status(201).json(toPurchase(row));
});

router.delete("/purchases/:id", async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(purchasesTable).where(eq(purchasesTable.id, id));
  return res.status(204).send();
});

function toPurchase(row: typeof purchasesTable.$inferSelect) {
  return {
    id: row.id,
    vendorName: row.vendorName,
    purchaseDate: row.purchaseDate ?? null,
    notes: row.notes ?? null,
    items: row.items as object[],
    totalAmount: parseFloat(row.totalAmount as string),
    createdAt: row.createdAt.toISOString(),
  };
}

export default router;
