import { Router } from "express";
import { db } from "@workspace/db";
import { stockMovementsTable, productsTable } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";

const router = Router();

router.get("/stock/movements", async (req, res) => {
  const productId = req.query.productId ? Number(req.query.productId) : null;
  const limit = Math.min(Number(req.query.limit ?? 100), 500);

  const rows = productId
    ? await db.select().from(stockMovementsTable)
        .where(eq(stockMovementsTable.productId, productId))
        .orderBy(desc(stockMovementsTable.createdAt))
        .limit(limit)
    : await db.select().from(stockMovementsTable)
        .orderBy(desc(stockMovementsTable.createdAt))
        .limit(limit);

  return res.json(rows.map((r) => ({
    ...r,
    qtyChange: parseFloat(r.qtyChange as string),
  })));
});

router.get("/stock/inventory", async (_req, res) => {
  const products = await db.select().from(productsTable);
  const movements = await db.select().from(stockMovementsTable);

  const movByProduct = new Map<number, number>();
  for (const m of movements) {
    const pid = m.productId;
    if (pid == null) continue;
    movByProduct.set(pid, (movByProduct.get(pid) ?? 0) + parseFloat(m.qtyChange as string));
  }

  return res.json(products.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    unit: p.unit,
    stockQuantity: p.stockQuantity,
    movementTotal: movByProduct.get(p.id) ?? 0,
    lowStock: p.stockQuantity <= p.lowStockThreshold,
  })));
});

export default router;
