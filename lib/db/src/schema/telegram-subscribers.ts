import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const telegramSubscribersTable = pgTable("telegram_subscribers", {
  id: serial("id").primaryKey(),
  chatId: text("chat_id").notNull().unique(),
  chatTitle: text("chat_title"),
  reportTypes: text("report_types").notNull().default("daily,weekly"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type TelegramSubscriber = typeof telegramSubscribersTable.$inferSelect;
