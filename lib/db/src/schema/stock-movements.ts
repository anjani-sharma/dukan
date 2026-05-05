import { pgTable, serial, text, numeric, integer, timestamp } from "drizzle-orm/pg-core";
import { productsTable } from "./products";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const stockMovementsTable = pgTable("stock_movements", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").references(() => productsTable.id),
  productName: text("product_name").notNull(),
  movementType: text("movement_type").notNull(), // sale | purchase | return | adjustment
  qtyChange: numeric("qty_change", { precision: 12, scale: 3 }).notNull(),
  referenceId: integer("reference_id"),
  referenceType: text("reference_type"), // sale | purchase | return
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertStockMovementSchema = createInsertSchema(stockMovementsTable).omit({ id: true, createdAt: true });
export type InsertStockMovement = z.infer<typeof insertStockMovementSchema>;
export type StockMovement = typeof stockMovementsTable.$inferSelect;
