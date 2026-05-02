import { Router } from "express";
import { db } from "@workspace/db";
import { salesTable, customersTable, productsTable, creditPaymentsTable } from "@workspace/db";
import { lte, gte, sql } from "drizzle-orm";
import { GetRecentActivityQueryParams, GetSalesChartQueryParams } from "@workspace/api-zod";

const router = Router();

router.get("/dashboard/summary", async (_req, res) => {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const allSales = await db.select().from(salesTable);
  const allProducts = await db.select().from(productsTable);
  const allCustomers = await db.select().from(customersTable);
  const allPayments = await db.select().from(creditPaymentsTable);

  const todaySales = allSales
    .filter((s) => s.createdAt >= todayStart)
    .reduce((sum, s) => sum + parseFloat(s.totalAmount as string), 0);

  const monthSales = allSales
    .filter((s) => s.createdAt >= monthStart)
    .reduce((sum, s) => sum + parseFloat(s.totalAmount as string), 0);

  const todayTransactions = allSales.filter((s) => s.createdAt >= todayStart).length;
  const monthTransactions = allSales.filter((s) => s.createdAt >= monthStart).length;

  const totalCredit = allSales.reduce((sum, s) => sum + parseFloat(s.creditAmount as string), 0);
  const totalPaid = allPayments.reduce((sum, p) => sum + parseFloat(p.amount as string), 0);
  const totalOutstanding = Math.max(0, totalCredit - totalPaid);

  const lowStockCount = allProducts.filter((p) => p.stockQuantity <= p.lowStockThreshold).length;

  return res.json({
    todaySales,
    monthSales,
    totalOutstanding,
    totalCustomers: allCustomers.length,
    totalProducts: allProducts.length,
    lowStockCount,
    todayTransactions,
    monthTransactions,
  });
});

router.get("/dashboard/recent-activity", async (req, res) => {
  const query = GetRecentActivityQueryParams.parse(req.query);
  const limit = query.limit ?? 20;

  const sales = await db.select().from(salesTable).orderBy(sql`${salesTable.createdAt} DESC`).limit(limit);
  const payments = await db.select().from(creditPaymentsTable).orderBy(sql`${creditPaymentsTable.createdAt} DESC`).limit(limit);
  const customers = await db.select().from(customersTable);
  const customerMap = new Map(customers.map((c) => [c.id, c.name]));

  const items = [
    ...sales.map((s) => ({
      id: `sale-${s.id}`,
      type: "sale" as const,
      description: `Sale of ${(s.items as { productName: string }[]).map((i) => i.productName).join(", ")} — ${s.customerId ? (customerMap.get(s.customerId) ?? "Customer") : "Walk-in"}`,
      amount: parseFloat(s.totalAmount as string),
      createdAt: s.createdAt.toISOString(),
    })),
    ...payments.map((p) => ({
      id: `payment-${p.id}`,
      type: "payment" as const,
      description: `Payment received from ${customerMap.get(p.customerId) ?? "Customer"}`,
      amount: parseFloat(p.amount as string),
      createdAt: p.createdAt.toISOString(),
    })),
  ];

  items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return res.json(items.slice(0, limit));
});

router.get("/dashboard/sales-chart", async (req, res) => {
  const query = GetSalesChartQueryParams.parse(req.query);
  const days = query.days ?? 30;
  const now = new Date();
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - days + 1);
  startDate.setHours(0, 0, 0, 0);

  const allSales = await db.select().from(salesTable);
  const filtered = allSales.filter((s) => s.createdAt >= startDate);

  const byDate: Record<string, { total: number; transactions: number }> = {};
  for (let i = 0; i < days; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    byDate[key] = { total: 0, transactions: 0 };
  }

  for (const s of filtered) {
    const key = s.createdAt.toISOString().slice(0, 10);
    if (byDate[key]) {
      byDate[key].total += parseFloat(s.totalAmount as string);
      byDate[key].transactions += 1;
    }
  }

  return res.json(Object.entries(byDate).map(([date, v]) => ({ date, ...v })));
});

router.get("/dashboard/top-customers", async (_req, res) => {
  const allCustomers = await db.select().from(customersTable);
  const allSales = await db.select().from(salesTable);
  const allPayments = await db.select().from(creditPaymentsTable);

  const result = allCustomers.map((c) => {
    const cSales = allSales.filter((s) => s.customerId === c.id);
    const cPayments = allPayments.filter((p) => p.customerId === c.id);
    const totalCredit = cSales.reduce((sum, s) => sum + parseFloat(s.creditAmount as string), 0);
    const totalPaid = cPayments.reduce((sum, p) => sum + parseFloat(p.amount as string), 0);
    return {
      id: c.id,
      name: c.name,
      phone: c.phone ?? null,
      outstandingBalance: Math.max(0, totalCredit - totalPaid),
    };
  });

  result.sort((a, b) => b.outstandingBalance - a.outstandingBalance);
  return res.json(result.filter((c) => c.outstandingBalance > 0).slice(0, 10));
});

router.get("/dashboard/cash-drawer", async (_req, res) => {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const allSales = await db.select().from(salesTable);
  const today = allSales.filter((s) => s.createdAt >= todayStart);

  const breakdown = { cash: 0, upi: 0, card: 0, credit: 0 };
  for (const s of today) {
    const mode = (s.paymentMode ?? "cash") as keyof typeof breakdown;
    const paid = parseFloat(s.paidAmount as string);
    if (mode in breakdown) breakdown[mode] += paid;
    else breakdown.cash += paid;
  }
  const totalSales = today.reduce((sum, s) => sum + parseFloat(s.totalAmount as string), 0);

  return res.json({
    date: todayStart.toISOString().slice(0, 10),
    totalSales,
    cash: breakdown.cash,
    upi: breakdown.upi,
    card: breakdown.card,
    credit: breakdown.credit,
    totalTransactions: today.length,
  });
});

export default router;
