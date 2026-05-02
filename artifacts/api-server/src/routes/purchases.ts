import { Router } from "express";
import { db } from "@workspace/db";
import { purchasesTable, productsTable } from "@workspace/db";
import { eq, ilike, sql } from "drizzle-orm";

const router = Router();

router.get("/purchases", async (_req, res) => {
  const rows = await db.select().from(purchasesTable).orderBy(sql`${purchasesTable.createdAt} DESC`);
  return res.json(rows.map(toPurchase));
});

// Duplicate check: same vendor + same total + same date
router.get("/purchases/check-duplicate", async (req, res) => {
  const vendorName = (req.query.vendorName as string ?? "").trim().toLowerCase();
  const totalAmount = req.query.totalAmount ? parseFloat(req.query.totalAmount as string) : null;
  const purchaseDate = req.query.purchaseDate as string | undefined;
  if (!vendorName || totalAmount == null) return res.json({ duplicate: false });
  const rows = await db.select().from(purchasesTable);
  const match = rows.find((r) => {
    const sameVendor = r.vendorName.trim().toLowerCase() === vendorName;
    const sameTotal = Math.abs(parseFloat(r.totalAmount as string) - totalAmount) < 0.01;
    const sameDate = purchaseDate ? r.purchaseDate === purchaseDate : true;
    return sameVendor && sameTotal && sameDate;
  });
  if (match) return res.json({ duplicate: true, existingPurchase: toPurchase(match) });
  return res.json({ duplicate: false });
});

router.post("/purchases", async (req, res) => {
  const body = req.body as {
    vendorName: string;
    purchaseDate?: string | null;
    notes?: string | null;
    items: { productId?: number | null; productName?: string; name?: string; quantity: number; unitPrice?: number }[];
    applyStock?: boolean;
  };

  const items = (body.items ?? []).map((i) => {
    const productName = i.productName ?? i.name ?? "";
    const unitPrice = i.unitPrice ?? 0;
    return {
      productId: i.productId ?? null,
      productName,
      quantity: i.quantity,
      unitPrice,
      subtotal: i.quantity * unitPrice,
    };
  });
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
      const nameKey = item.productName?.toLowerCase();
      const pid = item.productId ?? (nameKey ? byName.get(nameKey)?.id : null) ?? null;
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
