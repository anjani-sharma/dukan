import { Router } from "express";
import { db } from "@workspace/db";
import { salesTable, customersTable, productsTable, creditPaymentsTable, invoicesTable } from "@workspace/db";

const router = Router();

router.get("/analytics/summary", async (_req, res) => {
  const [allSales, allPurchases, allCustomers, allPayments, allProducts] = await Promise.all([
    db.select().from(salesTable),
    db.select().from(invoicesTable),
    db.select().from(customersTable),
    db.select().from(creditPaymentsTable),
    db.select().from(productsTable),
  ]);

  const purchaseInvoices = allPurchases.filter((inv) => inv.type === "purchase");

  // Revenue = total of all sales
  const totalRevenue = allSales.reduce((s, r) => s + parseFloat(r.totalAmount as string), 0);

  // COGS estimate = cost price * quantity for each sale item (cross-referenced with products)
  const productCostMap: Record<string, number> = {};
  allProducts.forEach((p) => { productCostMap[p.name.toLowerCase()] = p.costPrice; });

  let totalCOGS = 0;
  allSales.forEach((sale) => {
    const items = (sale.items as { productName: string; quantity: number; unitPrice: number }[]) ?? [];
    items.forEach((item) => {
      const cost = productCostMap[item.productName.toLowerCase()] ?? 0;
      totalCOGS += cost * item.quantity;
    });
  });

  // Purchase invoices = supplier bills
  const totalSupplierBills = purchaseInvoices.reduce((s, inv) => s + (inv.amount ? parseFloat(inv.amount as string) : 0), 0);
  const unpaidSupplierBills = purchaseInvoices.filter((inv) => !inv.paid).reduce((s, inv) => s + (inv.amount ? parseFloat(inv.amount as string) : 0), 0);
  const paidSupplierBills = totalSupplierBills - unpaidSupplierBills;

  // Customer money to collect
  const totalCreditGiven = allSales.reduce((s, r) => s + parseFloat(r.creditAmount as string), 0);
  const totalCreditPaid = allPayments.reduce((s, r) => s + parseFloat(r.amount as string), 0);
  const toCollect = Math.max(0, totalCreditGiven - totalCreditPaid);

  // Gross profit = revenue - COGS
  const grossProfit = totalRevenue - totalCOGS;
  const grossMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

  // Net position: money in pocket = gross profit - unpaid supplier bills
  const netPosition = grossProfit - unpaidSupplierBills;

  return res.json({
    totalRevenue,
    totalCOGS,
    grossProfit,
    grossMargin,
    netPosition,
    toCollect,
    totalSupplierBills,
    paidSupplierBills,
    unpaidSupplierBills,
    totalSalesCount: allSales.length,
    unpaidInvoiceCount: purchaseInvoices.filter((inv) => !inv.paid).length,
    debtorCount: allCustomers.filter((c) => {
      const credit = allSales.filter((s) => s.customerId === c.id).reduce((s, r) => s + parseFloat(r.creditAmount as string), 0);
      const paid = allPayments.filter((p) => p.customerId === c.id).reduce((s, r) => s + parseFloat(r.amount as string), 0);
      return credit - paid > 0;
    }).length,
  });
});

router.get("/analytics/monthly", async (_req, res) => {
  const allSales = await db.select().from(salesTable);
  const allPurchases = await db.select().from(invoicesTable);
  const allProducts = await db.select().from(productsTable);

  const productCostMap: Record<string, number> = {};
  allProducts.forEach((p) => { productCostMap[p.name.toLowerCase()] = p.costPrice; });

  // Build a map of months → {revenue, cogs, purchases}
  const monthMap: Record<string, { month: string; revenue: number; cogs: number; purchases: number }> = {};

  const getMonth = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

  allSales.forEach((sale) => {
    const m = getMonth(new Date(sale.createdAt));
    if (!monthMap[m]) monthMap[m] = { month: m, revenue: 0, cogs: 0, purchases: 0 };
    monthMap[m].revenue += parseFloat(sale.totalAmount as string);
    const items = (sale.items as { productName: string; quantity: number }[]) ?? [];
    items.forEach((item) => {
      const cost = productCostMap[item.productName.toLowerCase()] ?? 0;
      monthMap[m].cogs += cost * item.quantity;
    });
  });

  allPurchases.filter((inv) => inv.type === "purchase").forEach((inv) => {
    const m = getMonth(new Date(inv.createdAt));
    if (!monthMap[m]) monthMap[m] = { month: m, revenue: 0, cogs: 0, purchases: 0 };
    monthMap[m].purchases += inv.amount ? parseFloat(inv.amount as string) : 0;
  });

  const rows = Object.values(monthMap)
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((r) => ({ ...r, grossProfit: r.revenue - r.cogs }));

  return res.json(rows);
});

router.get("/analytics/debtors", async (_req, res) => {
  const [allCustomers, allSales, allPayments] = await Promise.all([
    db.select().from(customersTable),
    db.select().from(salesTable),
    db.select().from(creditPaymentsTable),
  ]);

  const rows = allCustomers.map((c) => {
    const cSales = allSales.filter((s) => s.customerId === c.id);
    const cPayments = allPayments.filter((p) => p.customerId === c.id);
    const credit = cSales.reduce((s, r) => s + parseFloat(r.creditAmount as string), 0);
    const paid = cPayments.reduce((s, r) => s + parseFloat(r.amount as string), 0);
    const outstanding = Math.max(0, credit - paid);
    return { id: c.id, name: c.name, phone: c.phone, outstanding, salesCount: cSales.length };
  }).filter((r) => r.outstanding > 0).sort((a, b) => b.outstanding - a.outstanding);

  return res.json(rows);
});

router.get("/analytics/creditors", async (_req, res) => {
  const unpaid = await db.select().from(invoicesTable);
  const rows = unpaid
    .filter((inv) => inv.type === "purchase" && !inv.paid && inv.amount)
    .sort((a, b) => parseFloat(b.amount as string) - parseFloat(a.amount as string))
    .map((inv) => ({
      id: inv.id,
      vendorOrCustomer: inv.vendorOrCustomer,
      amount: parseFloat(inv.amount as string),
      invoiceDate: inv.invoiceDate,
      createdAt: inv.createdAt.toISOString(),
    }));
  return res.json(rows);
});

export default router;
