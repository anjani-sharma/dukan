import { Router } from "express";
import { db } from "@workspace/db";
import { productsTable } from "@workspace/db";
import { eq, ilike, lte } from "drizzle-orm";
import {
  ListProductsQueryParams,
  CreateProductBody,
  GetProductParams,
  UpdateProductParams,
  UpdateProductBody,
  DeleteProductParams,
} from "@workspace/api-zod";

const router = Router();

router.get("/products", async (req, res) => {
  const query = ListProductsQueryParams.parse(req.query);
  let rows = await db.select().from(productsTable);
  if (query.search) {
    rows = await db.select().from(productsTable).where(ilike(productsTable.name, `%${query.search}%`));
  } else if (query.lowStock) {
    rows = await db.select().from(productsTable).where(lte(productsTable.stockQuantity, productsTable.lowStockThreshold));
  }
  return res.json(rows.map(toProduct));
});

// Duplicate name check
router.get("/products/check-duplicate", async (req, res) => {
  const name = (req.query.name as string ?? "").trim().toLowerCase();
  const excludeId = req.query.excludeId ? Number(req.query.excludeId) : null;
  if (!name) return res.json({ duplicate: false });
  const rows = await db.select().from(productsTable);
  const match = rows.find((r) => {
    if (excludeId && r.id === excludeId) return false;
    return r.name.trim().toLowerCase() === name;
  });
  if (match) return res.json({ duplicate: true, existingProduct: toProduct(match) });
  return res.json({ duplicate: false });
});

router.post("/products", async (req, res) => {
  const body = CreateProductBody.parse(req.body);
  const [row] = await db.insert(productsTable).values({
    name: body.name,
    description: body.description ?? null,
    sku: body.sku ?? null,
    category: body.category ?? null,
    costPrice: String(body.costPrice),
    sellingPrice: String(body.sellingPrice),
    stockQuantity: body.stockQuantity,
    lowStockThreshold: body.lowStockThreshold ?? 5,
    unit: body.unit ?? "pcs",
    hsnCode: (body as { hsnCode?: string | null }).hsnCode ?? null,
    gstRate: (body as { gstRate?: number }).gstRate ?? 0,
  }).returning();
  return res.status(201).json(toProduct(row));
});

router.get("/products/:id", async (req, res) => {
  const { id } = GetProductParams.parse({ id: Number(req.params.id) });
  const [row] = await db.select().from(productsTable).where(eq(productsTable.id, id));
  if (!row) return res.status(404).json({ error: "Not found" });
  return res.json(toProduct(row));
});

router.put("/products/:id", async (req, res) => {
  const { id } = UpdateProductParams.parse({ id: Number(req.params.id) });
  const body = UpdateProductBody.parse(req.body);
  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.description !== undefined) updates.description = body.description;
  if (body.sku !== undefined) updates.sku = body.sku;
  if (body.category !== undefined) updates.category = body.category;
  if (body.costPrice !== undefined) updates.costPrice = String(body.costPrice);
  if (body.sellingPrice !== undefined) updates.sellingPrice = String(body.sellingPrice);
  if (body.stockQuantity !== undefined) updates.stockQuantity = body.stockQuantity;
  if (body.lowStockThreshold !== undefined) updates.lowStockThreshold = body.lowStockThreshold;
  if (body.unit !== undefined) updates.unit = body.unit;
  if ((body as { hsnCode?: string | null }).hsnCode !== undefined) updates.hsnCode = (body as { hsnCode?: string | null }).hsnCode;
  if ((body as { gstRate?: number }).gstRate !== undefined) updates.gstRate = (body as { gstRate?: number }).gstRate;
  updates.updatedAt = new Date();
  const [row] = await db.update(productsTable).set(updates).where(eq(productsTable.id, id)).returning();
  if (!row) return res.status(404).json({ error: "Not found" });
  return res.json(toProduct(row));
});

router.delete("/products/:id", async (req, res) => {
  const { id } = DeleteProductParams.parse({ id: Number(req.params.id) });
  await db.delete(productsTable).where(eq(productsTable.id, id));
  return res.status(204).send();
});

function toProduct(row: typeof productsTable.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    sku: row.sku ?? null,
    category: row.category ?? null,
    costPrice: parseFloat(row.costPrice),
    sellingPrice: parseFloat(row.sellingPrice),
    stockQuantity: row.stockQuantity,
    lowStockThreshold: row.lowStockThreshold,
    unit: row.unit,
    hsnCode: row.hsnCode ?? null,
    gstRate: row.gstRate,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export default router;
