import { pgTable, serial, text, numeric, date, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const vendorPaymentsTable = pgTable("vendor_payments", {
  id: serial("id").primaryKey(),
  vendorName: text("vendor_name").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  paymentDate: date("payment_date"),
  paymentMethod: text("payment_method").notNull().default("cash"),
  proofImageUrl: text("proof_image_url"),
  notes: text("notes"),
  linkedInvoiceId: integer("linked_invoice_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertVendorPaymentSchema = createInsertSchema(vendorPaymentsTable).omit({ id: true, createdAt: true });
export type InsertVendorPayment = z.infer<typeof insertVendorPaymentSchema>;
export type VendorPayment = typeof vendorPaymentsTable.$inferSelect;
