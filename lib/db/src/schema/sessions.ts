import { pgTable, text, bigint } from "drizzle-orm/pg-core";

export const sessionsTable = pgTable("sessions", {
  token: text("token").primaryKey(),
  expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
});
