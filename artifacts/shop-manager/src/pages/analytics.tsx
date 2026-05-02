import { useQuery } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine } from "recharts";
import { TrendingUp, TrendingDown, ArrowDownLeft, ArrowUpRight, AlertCircle, CheckCircle } from "lucide-react";
import { format } from "date-fns";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

function useSummary() {
  return useQuery({ queryKey: ["analytics", "summary"], queryFn: async () => { const r = await fetch(`${BASE}/api/analytics/summary`); return r.json(); } });
}
function useMonthly() {
  return useQuery({ queryKey: ["analytics", "monthly"], queryFn: async () => { const r = await fetch(`${BASE}/api/analytics/monthly`); return r.json(); } });
}
function useDebtors() {
  return useQuery({ queryKey: ["analytics", "debtors"], queryFn: async () => { const r = await fetch(`${BASE}/api/analytics/debtors`); return r.json(); } });
}
function useCreditors() {
  return useQuery({ queryKey: ["analytics", "creditors"], queryFn: async () => { const r = await fetch(`${BASE}/api/analytics/creditors`); return r.json(); } });
}

function fmt(n: number) { return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }

function KpiCard({ label, value, sub, positive, icon: Icon }: { label: string; value: string; sub?: string; positive?: boolean; icon: typeof TrendingUp }) {
  return (
    <div className="bg-card border border-card-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</span>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${positive === true ? "bg-emerald-500/15" : positive === false ? "bg-red-500/15" : "bg-primary/15"}`}>
          <Icon className={`w-4 h-4 ${positive === true ? "text-emerald-400" : positive === false ? "text-red-400" : "text-primary"}`} />
        </div>
      </div>
      <div className={`text-2xl font-bold ${positive === true ? "text-emerald-400" : positive === false ? "text-red-400" : "text-foreground"}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

export default function Analytics() {
  const { data: summary, isLoading } = useSummary();
  const { data: monthly } = useMonthly();
  const { data: debtors } = useDebtors();
  const { data: creditors } = useCreditors();

  const monthlyFormatted = (monthly ?? []).map((m: { month: string; revenue: number; grossProfit: number; purchases: number }) => ({
    ...m,
    label: format(new Date(m.month + "-01"), "MMM yy"),
  }));

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Analytics</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Profit, loss, and cash flow overview</p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-28 bg-card border border-card-border rounded-xl animate-pulse" />)
        ) : (
          <>
            <KpiCard label="Total Revenue" value={fmt(summary?.totalRevenue ?? 0)} sub={`${summary?.totalSalesCount ?? 0} sales`} icon={TrendingUp} positive={true} />
            <KpiCard label="Gross Profit" value={fmt(summary?.grossProfit ?? 0)} sub={`${(summary?.grossMargin ?? 0).toFixed(1)}% margin`} icon={summary?.grossProfit >= 0 ? TrendingUp : TrendingDown} positive={summary?.grossProfit >= 0} />
            <KpiCard label="To Collect" value={fmt(summary?.toCollect ?? 0)} sub={`${summary?.debtorCount ?? 0} customers owe you`} icon={ArrowDownLeft} positive={true} />
            <KpiCard label="To Pay Suppliers" value={fmt(summary?.unpaidSupplierBills ?? 0)} sub={`${summary?.unpaidInvoiceCount ?? 0} unpaid invoices`} icon={ArrowUpRight} positive={false} />
          </>
        )}
      </div>

      {/* Net position */}
      {!isLoading && summary && (
        <div className={`rounded-xl p-5 border flex items-center gap-4 ${summary.netPosition >= 0 ? "bg-emerald-500/10 border-emerald-500/30" : "bg-red-500/10 border-red-500/30"}`}>
          <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${summary.netPosition >= 0 ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
            {summary.netPosition >= 0 ? <CheckCircle className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
          </div>
          <div>
            <div className="text-sm font-medium text-foreground">Net Position (Profit after Supplier Bills)</div>
            <div className={`text-2xl font-bold mt-0.5 ${summary.netPosition >= 0 ? "text-emerald-400" : "text-red-400"}`}>{fmt(summary.netPosition)}</div>
            <div className="text-xs text-muted-foreground mt-1">
              Gross profit {fmt(summary.grossProfit)} − unpaid bills {fmt(summary.unpaidSupplierBills)}
            </div>
          </div>
        </div>
      )}

      {/* Monthly chart */}
      {monthlyFormatted.length > 0 && (
        <div className="bg-card border border-card-border rounded-xl p-5">
          <h2 className="text-sm font-semibold text-foreground mb-4">Monthly Revenue vs Gross Profit</h2>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={monthlyFormatted} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(217 32% 20%)" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(215 20% 55%)" }} />
              <YAxis tick={{ fontSize: 11, fill: "hsl(215 20% 55%)" }} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
              <Tooltip
                contentStyle={{ background: "hsl(222 44% 14%)", border: "1px solid hsl(217 32% 22%)", borderRadius: 8, fontSize: 12 }}
                formatter={(v: number, name: string) => [fmt(v), name === "revenue" ? "Revenue" : name === "grossProfit" ? "Gross Profit" : "Purchases"]}
              />
              <Legend formatter={(v) => v === "revenue" ? "Revenue" : v === "grossProfit" ? "Gross Profit" : "Purchases"} />
              <ReferenceLine y={0} stroke="hsl(215 20% 40%)" />
              <Bar dataKey="revenue" fill="hsl(38 92% 55%)" radius={[4, 4, 0, 0]} opacity={0.8} />
              <Bar dataKey="grossProfit" fill="hsl(142 71% 45%)" radius={[4, 4, 0, 0]} opacity={0.8} />
              <Bar dataKey="purchases" fill="hsl(0 72% 51%)" radius={[4, 4, 0, 0]} opacity={0.6} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Money to collect */}
        <div className="bg-card border border-card-border rounded-xl p-5">
          <h2 className="text-sm font-semibold text-foreground mb-1">Money to Collect</h2>
          <p className="text-xs text-muted-foreground mb-4">Customers who owe you</p>
          {!debtors || debtors.length === 0 ? (
            <div className="text-center py-8">
              <CheckCircle className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">All customers are settled</p>
            </div>
          ) : (
            <div className="space-y-2">
              {debtors.map((d: { id: number; name: string; phone?: string; outstanding: number; salesCount: number }) => (
                <div key={d.id} className="flex items-center justify-between py-2.5 px-3 rounded-lg hover:bg-accent/30 transition-colors">
                  <div>
                    <div className="text-sm font-medium text-foreground">{d.name}</div>
                    <div className="text-xs text-muted-foreground">{d.salesCount} sales{d.phone ? ` · ${d.phone}` : ""}</div>
                  </div>
                  <div className="text-sm font-bold text-emerald-400">{fmt(d.outstanding)}</div>
                </div>
              ))}
              <div className="pt-2 border-t border-card-border flex justify-between text-sm font-semibold">
                <span className="text-muted-foreground">Total</span>
                <span className="text-emerald-400">{fmt((debtors ?? []).reduce((s: number, d: { outstanding: number }) => s + d.outstanding, 0))}</span>
              </div>
            </div>
          )}
        </div>

        {/* Money to pay */}
        <div className="bg-card border border-card-border rounded-xl p-5">
          <h2 className="text-sm font-semibold text-foreground mb-1">Money to Pay Suppliers</h2>
          <p className="text-xs text-muted-foreground mb-4">Unpaid purchase invoices</p>
          {!creditors || creditors.length === 0 ? (
            <div className="text-center py-8">
              <CheckCircle className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No outstanding supplier bills</p>
            </div>
          ) : (
            <div className="space-y-2">
              {creditors.map((c: { id: number; vendorOrCustomer?: string; amount: number; invoiceDate?: string }) => (
                <div key={c.id} className="flex items-center justify-between py-2.5 px-3 rounded-lg hover:bg-accent/30 transition-colors">
                  <div>
                    <div className="text-sm font-medium text-foreground">{c.vendorOrCustomer ?? "Unknown supplier"}</div>
                    {c.invoiceDate && <div className="text-xs text-muted-foreground">{c.invoiceDate}</div>}
                  </div>
                  <div className="text-sm font-bold text-red-400">{fmt(c.amount)}</div>
                </div>
              ))}
              <div className="pt-2 border-t border-card-border flex justify-between text-sm font-semibold">
                <span className="text-muted-foreground">Total</span>
                <span className="text-red-400">{fmt((creditors ?? []).reduce((s: number, c: { amount: number }) => s + c.amount, 0))}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Cost breakdown */}
      {!isLoading && summary && (
        <div className="bg-card border border-card-border rounded-xl p-5">
          <h2 className="text-sm font-semibold text-foreground mb-4">Profit & Loss Breakdown</h2>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between py-2 border-b border-card-border">
              <span className="text-muted-foreground">Total Revenue (Sales)</span>
              <span className="font-semibold text-foreground">{fmt(summary.totalRevenue)}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-card-border">
              <span className="text-muted-foreground">Cost of Goods Sold</span>
              <span className="font-semibold text-red-400">− {fmt(summary.totalCOGS)}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-card-border">
              <span className="font-medium text-foreground">Gross Profit</span>
              <span className={`font-bold ${summary.grossProfit >= 0 ? "text-emerald-400" : "text-red-400"}`}>{fmt(summary.grossProfit)}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-card-border">
              <span className="text-muted-foreground">Unpaid Supplier Bills</span>
              <span className="font-semibold text-red-400">− {fmt(summary.unpaidSupplierBills)}</span>
            </div>
            <div className="flex justify-between py-2">
              <span className="font-semibold text-foreground">Net Position</span>
              <span className={`font-bold text-base ${summary.netPosition >= 0 ? "text-emerald-400" : "text-red-400"}`}>{fmt(summary.netPosition)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
