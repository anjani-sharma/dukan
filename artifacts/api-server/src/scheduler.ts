import cron from "node-cron";
import { db } from "@workspace/db";
import { salesTable, productsTable, customersTable, creditPaymentsTable, telegramSubscribersTable, purchasesTable } from "@workspace/db";
import { gte } from "drizzle-orm";
import { logger } from "./lib/logger";

async function sendTelegramMessage(chatId: string, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  });
}

async function getSubscribers(): Promise<string[]> {
  const rows = await db.select().from(telegramSubscribersTable);
  return rows.map((r) => r.chatId);
}

export async function sendDailyReport() {
  const subscribers = await getSubscribers();
  if (subscribers.length === 0) return;

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const allSales = await db.select().from(salesTable);
  const allProducts = await db.select().from(productsTable);
  const allCustomers = await db.select().from(customersTable);
  const allPayments = await db.select().from(creditPaymentsTable);
  const todayPurchases = await db.select().from(purchasesTable).where(gte(purchasesTable.createdAt, todayStart));

  const todaySales = allSales.filter((s) => s.createdAt >= todayStart);
  const monthSales = allSales.filter((s) => s.createdAt >= monthStart);

  const todayRevenue = todaySales.reduce((sum, s) => sum + parseFloat(s.totalAmount as string), 0);
  const monthRevenue = monthSales.reduce((sum, s) => sum + parseFloat(s.totalAmount as string), 0);

  const cashToday = todaySales.filter((s) => s.paymentMode === "cash").reduce((sum, s) => sum + parseFloat(s.paidAmount as string), 0);
  const upiToday = todaySales.filter((s) => s.paymentMode === "upi").reduce((sum, s) => sum + parseFloat(s.paidAmount as string), 0);
  const cardToday = todaySales.filter((s) => s.paymentMode === "card").reduce((sum, s) => sum + parseFloat(s.paidAmount as string), 0);

  const totalCredit = allSales.reduce((sum, s) => sum + parseFloat(s.creditAmount as string), 0);
  const totalPaid = allPayments.reduce((sum, p) => sum + parseFloat(p.amount as string), 0);
  const outstanding = Math.max(0, totalCredit - totalPaid);

  const lowStock = allProducts.filter((p) => p.stockQuantity <= p.lowStockThreshold);
  const todaySpend = todayPurchases.reduce((sum, p) => sum + parseFloat(p.totalAmount as string), 0);

  const dateStr = now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata" });

  let msg = `📊 <b>Daily Report — ${dateStr}</b>\n\n`;
  msg += `💰 <b>Today's Sales</b>\n`;
  msg += `  Revenue: ₹${todayRevenue.toFixed(2)} (${todaySales.length} transactions)\n`;
  if (cashToday > 0) msg += `  Cash: ₹${cashToday.toFixed(2)}\n`;
  if (upiToday > 0) msg += `  UPI: ₹${upiToday.toFixed(2)}\n`;
  if (cardToday > 0) msg += `  Card: ₹${cardToday.toFixed(2)}\n`;
  if (todaySpend > 0) msg += `  Stock Purchased: ₹${todaySpend.toFixed(2)}\n`;

  msg += `\n📆 Month-to-Date: ₹${monthRevenue.toFixed(2)} (${monthSales.length} sales)\n`;
  msg += `💳 Total Outstanding: ₹${outstanding.toFixed(2)}\n`;

  if (lowStock.length > 0) {
    msg += `\n⚠️ <b>Low Stock (${lowStock.length} items):</b>\n`;
    lowStock.slice(0, 5).forEach((p) => {
      msg += `  • ${p.name}: ${p.stockQuantity} ${p.unit} left\n`;
    });
  }

  const topDebtors = allCustomers
    .map((c) => {
      const cSales = allSales.filter((s) => s.customerId === c.id);
      const cPayments = allPayments.filter((p) => p.customerId === c.id);
      const credit = cSales.reduce((sum, s) => sum + parseFloat(s.creditAmount as string), 0);
      const paid = cPayments.reduce((sum, p) => sum + parseFloat(p.amount as string), 0);
      return { name: c.name, balance: Math.max(0, credit - paid) };
    })
    .filter((c) => c.balance > 0)
    .sort((a, b) => b.balance - a.balance)
    .slice(0, 3);

  if (topDebtors.length > 0) {
    msg += `\n💳 <b>Top Unpaid:</b>\n`;
    topDebtors.forEach((c) => {
      msg += `  • ${c.name}: ₹${c.balance.toFixed(2)}\n`;
    });
  }

  msg += `\n<i>Sent by दुकान · RK Enterprises</i>`;

  for (const chatId of subscribers) {
    await sendTelegramMessage(chatId, msg);
  }
  logger.info({ subscribers: subscribers.length }, "Daily report sent");
}

export async function sendWeeklyReport() {
  const subscribers = await getSubscribers();
  if (subscribers.length === 0) return;

  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - 6);
  weekStart.setHours(0, 0, 0, 0);

  const allSales = await db.select().from(salesTable).where(gte(salesTable.createdAt, weekStart));
  const allProducts = await db.select().from(productsTable);
  const allPayments = await db.select().from(creditPaymentsTable);
  const weekPurchases = await db.select().from(purchasesTable).where(gte(purchasesTable.createdAt, weekStart));

  const revenue = allSales.reduce((sum, s) => sum + parseFloat(s.totalAmount as string), 0);
  const cashRev = allSales.filter((s) => s.paymentMode === "cash").reduce((sum, s) => sum + parseFloat(s.paidAmount as string), 0);
  const upiRev = allSales.filter((s) => s.paymentMode === "upi").reduce((sum, s) => sum + parseFloat(s.paidAmount as string), 0);
  const cardRev = allSales.filter((s) => s.paymentMode === "card").reduce((sum, s) => sum + parseFloat(s.paidAmount as string), 0);
  const creditRev = allSales.filter((s) => s.paymentMode === "credit").reduce((sum, s) => sum + parseFloat(s.totalAmount as string), 0);
  const weekSpend = weekPurchases.reduce((sum, p) => sum + parseFloat(p.totalAmount as string), 0);
  const grossProfit = revenue - weekSpend;

  const lowStock = allProducts.filter((p) => p.stockQuantity <= p.lowStockThreshold);

  const dailyBreakdown: Record<string, number> = {};
  allSales.forEach((s) => {
    const day = s.createdAt.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
    dailyBreakdown[day] = (dailyBreakdown[day] ?? 0) + parseFloat(s.totalAmount as string);
  });

  const fromDate = weekStart.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
  const toDate = now.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

  let msg = `📈 <b>Weekly Report — ${fromDate} to ${toDate}</b>\n\n`;
  msg += `💰 <b>Revenue: ₹${revenue.toFixed(2)}</b> (${allSales.length} sales)\n`;
  msg += `  Cash: ₹${cashRev.toFixed(2)}\n`;
  if (upiRev > 0) msg += `  UPI: ₹${upiRev.toFixed(2)}\n`;
  if (cardRev > 0) msg += `  Card: ₹${cardRev.toFixed(2)}\n`;
  if (creditRev > 0) msg += `  Credit: ₹${creditRev.toFixed(2)}\n`;

  if (weekSpend > 0) {
    msg += `\n🛒 Stock Purchased: ₹${weekSpend.toFixed(2)}\n`;
    msg += `📊 Est. Gross Profit: ₹${grossProfit.toFixed(2)}\n`;
  }

  if (Object.keys(dailyBreakdown).length > 1) {
    msg += `\n📅 <b>Day-wise Sales:</b>\n`;
    Object.entries(dailyBreakdown).forEach(([day, amt]) => {
      msg += `  ${day}: ₹${amt.toFixed(2)}\n`;
    });
  }

  if (lowStock.length > 0) {
    msg += `\n⚠️ <b>Low Stock (${lowStock.length} items):</b>\n`;
    lowStock.slice(0, 5).forEach((p) => {
      msg += `  • ${p.name}: ${p.stockQuantity} ${p.unit}\n`;
    });
  }

  msg += `\n<i>Weekly summary by दुकान · RK Enterprises</i>`;

  for (const chatId of subscribers) {
    await sendTelegramMessage(chatId, msg);
  }
  logger.info({ subscribers: subscribers.length }, "Weekly report sent");
}

export function startScheduler() {
  // Daily report at 7 PM IST = 13:30 UTC
  cron.schedule("30 13 * * *", async () => {
    try {
      await sendDailyReport();
    } catch (err) {
      logger.error({ err }, "Failed to send daily report");
    }
  });

  // Weekly report every Sunday at 8 AM IST = 02:30 UTC
  cron.schedule("30 2 * * 0", async () => {
    try {
      await sendWeeklyReport();
    } catch (err) {
      logger.error({ err }, "Failed to send weekly report");
    }
  });

  logger.info("Scheduler started — daily 7 PM IST, weekly Sunday 8 AM IST");
}
