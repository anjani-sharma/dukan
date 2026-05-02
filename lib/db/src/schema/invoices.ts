import { pgTable, serial, text, numeric, date, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const invoicesTable = pgTable("invoices", {
  id: serial("id").primaryKey(),
  type: text("type").notNull().default("purchase"),
  vendorOrCustomer: text("vendor_or_customer"),
  amount: numeric("amount", { precision: 12, scale: 2 }),
  invoiceDate: date("invoice_date"),
  imageUrl: text("image_url"),
  notes: text("notes"),
  aiExtractedData: jsonb("ai_extracted_data"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertInvoiceSchema = createInsertSchema(invoicesTable).omit({ id: true, createdAt: true });
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type Invoice = typeof invoicesTable.$inferSelect;
