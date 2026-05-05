import { Router } from "express";
import { db } from "@workspace/db";
import { purchasesTable, productsTable, stockMovementsTable } from "@workspace/db";
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

  // Auto-increment stock + write movements (word-overlap fuzzy matching)
  if (body.applyStock !== false) {
    const allProducts = await db.select().from(productsTable);
    const tok = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9.]/g, " ").split(/\s+/).filter(Boolean));
    const wordSim = (a: string, b: string) => {
      const ta = tok(a); const tb = tok(b);
      let common = 0; for (const w of ta) if (tb.has(w)) common++;
      const union = new Set([...ta, ...tb]).size;
      return union === 0 ? 0 : common / union;
    };
    for (const item of items) {
      let matchedProduct: typeof allProducts[0] | null = null;
      if (item.productId) {
        matchedProduct = allProducts.find((p) => p.id === item.productId) ?? null;
      } else if (item.productName) {
        const name = item.productName;
        const lower = name.toLowerCase().trim();
        matchedProduct = allProducts.find((p) => p.name.toLowerCase() === lower)
          ?? allProducts.find((p) => p.name.toLowerCase().includes(lower) || lower.includes(p.name.toLowerCase()))
          ?? (() => {
            let best = null as typeof allProducts[0] | null;
            let bestScore = 0.35;
            for (const p of allProducts) {
              const s = wordSim(p.name, name);
              if (s > bestScore) { best = p; bestScore = s; }
            }
            return best;
          })();
      }
      const pid = matchedProduct?.id ?? null;
      if (pid) {
        await db.update(productsTable)
          .set({ stockQuantity: sql`${productsTable.stockQuantity} + ${item.quantity}` })
          .where(eq(productsTable.id, pid));
      }
      // Always write movement — unmatched items saved with productName for traceability
      await db.insert(stockMovementsTable).values({
        productId: pid,
        productName: matchedProduct?.name ?? item.productName,
        movementType: "purchase",
        qtyChange: String(item.quantity),
        referenceId: row.id,
        referenceType: "purchase",
        notes: pid ? null : `unmatched: "${item.productName}"`,
      });
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
