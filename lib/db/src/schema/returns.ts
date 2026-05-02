import { pgTable, serial, text, numeric, integer, jsonb, timestamp } from "drizzle-orm/pg-core";
import { customersTable } from "./customers";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const returnsTable = pgTable("returns", {
  id: serial("id").primaryKey(),
  saleId: integer("sale_id"),
  customerId: integer("customer_id").references(() => customersTable.id),
  items: jsonb("items").notNull().default([]),
  reason: text("reason"),
  totalAmount: numeric("total_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  refundMode: text("refund_mode").notNull().default("cash"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertReturnSchema = createInsertSchema(returnsTable).omit({ id: true, createdAt: true });
export type InsertReturn = z.infer<typeof insertReturnSchema>;
export type Return = typeof returnsTable.$inferSelect;
