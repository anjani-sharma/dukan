import { Router } from "express";
import { db } from "@workspace/db";
import { suppliersTable } from "@workspace/db";
import { eq, ilike, sql } from "drizzle-orm";

const router = Router();

router.get("/suppliers", async (_req, res) => {
  const rows = await db.select().from(suppliersTable).orderBy(sql`${suppliersTable.name} ASC`);
  return res.json(rows);
});

router.get("/suppliers/search", async (req, res) => {
  const q = (req.query.q as string ?? "").trim();
  if (!q) return res.json([]);
  const rows = await db.select().from(suppliersTable).where(ilike(suppliersTable.name, `%${q}%`));
  return res.json(rows);
});

router.post("/suppliers", async (req, res) => {
  const body = req.body as { name: string; phone?: string | null; address?: string | null };
  const [row] = await db.insert(suppliersTable).values({
    name: body.name,
    phone: body.phone ?? null,
    address: body.address ?? null,
  }).returning();
  return res.status(201).json(row);
});

router.post("/suppliers/upsert", async (req, res) => {
  const body = req.body as { name: string; phone?: string | null; address?: string | null };
  const name = body.name.trim();
  const [existing] = await db.select().from(suppliersTable).where(ilike(suppliersTable.name, name));
  if (existing) return res.json(existing);
  const [row] = await db.insert(suppliersTable).values({
    name,
    phone: body.phone ?? null,
    address: body.address ?? null,
  }).returning();
  return res.status(201).json(row);
});

router.put("/suppliers/:id", async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body as { name?: string; phone?: string | null; address?: string | null };
  const [row] = await db.update(suppliersTable)
    .set({ ...(body.name && { name: body.name }), phone: body.phone ?? null, address: body.address ?? null })
    .where(eq(suppliersTable.id, id))
    .returning();
  if (!row) return res.status(404).json({ error: "Not found" });
  return res.json(row);
});

router.delete("/suppliers/:id", async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(suppliersTable).where(eq(suppliersTable.id, id));
  return res.status(204).send();
});

export default router;
