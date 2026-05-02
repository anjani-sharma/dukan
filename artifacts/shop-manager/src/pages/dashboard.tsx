import { useGetDashboardSummary, useGetRecentActivity, useGetSalesChart, useGetTopCustomers, useListProducts, getGetDashboardSummaryQueryKey, getGetRecentActivityQueryKey, getGetSalesChartQueryKey, getGetTopCustomersQueryKey, getListProductsQueryKey } from "@workspace/api-client-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { TrendingUp, Users, Package, AlertTriangle, ShoppingCart, CreditCard, Clock, ArrowRight } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

function StatCard({ label, value, sub, icon: Icon, accent }: { label: string; value: string; sub?: string; icon: typeof TrendingUp; accent?: string }) {
  return (
    <div className="bg-card border border-card-border rounded-xl p-5 flex flex-col gap-3" data-testid={`stat-${label.toLowerCase().replace(/\s/g, "-")}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</span>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${accent ?? "bg-primary/15"}`}>
          <Icon className="w-4 h-4 text-primary" />
        </div>
      </div>
      <div>
        <div className="text-2xl font-bold text-foreground">{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { data: summary, isLoading: loadingSummary } = useGetDashboardSummary({ query: { queryKey: getGetDashboardSummaryQueryKey() } });
  const { data: activity, isLoading: loadingActivity } = useGetRecentActivity({ limit: 10 }, { query: { queryKey: getGetRecentActivityQueryKey({ limit: 10 }) } });
  const { data: chart } = useGetSalesChart({ days: 30 }, { query: { queryKey: getGetSalesChartQueryKey({ days: 30 }) } });
  const { data: topCustomers } = useGetTopCustomers({ query: { queryKey: getGetTopCustomersQueryKey() } });
  const { data: products } = useListProducts({}, { query: { queryKey: getListProductsQueryKey({}) } });

  const fmt = (n?: number) => `₹${(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const lowStockItems = (products ?? []).filter((p) => p.stockQuantity <= p.lowStockThreshold);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{format(new Date(), "EEEE, MMMM d, yyyy")}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {loadingSummary ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-card border border-card-border rounded-xl p-5 h-28 animate-pulse" />
          ))
        ) : (
          <>
            <StatCard label="Today's Sales" value={fmt(summary?.todaySales)} sub={`${summary?.todayTransactions ?? 0} transactions`} icon={ShoppingCart} />
            <StatCard label="Month Sales" value={fmt(summary?.monthSales)} sub={`${summary?.monthTransactions ?? 0} transactions`} icon={TrendingUp} />
            <StatCard label="Outstanding" value={fmt(summary?.totalOutstanding)} sub="Customer balances owed" icon={CreditCard} accent="bg-amber-400/15" />
            <StatCard label="Low Stock" value={String(summary?.lowStockCount ?? 0)} sub={`of ${summary?.totalProducts ?? 0} products`} icon={AlertTriangle} accent={summary?.lowStockCount ? "bg-red-500/15" : "bg-emerald-500/15"} />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Sales chart */}
        <div className="lg:col-span-2 bg-card border border-card-border rounded-xl p-5">
          <h2 className="text-sm font-semibold text-foreground mb-4">Sales — Last 30 Days</h2>
          {chart && chart.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={chart} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(38 92% 55%)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(38 92% 55%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(217 32% 20%)" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: "hsl(215 20% 55%)" }} tickFormatter={(v) => format(new Date(v + "T00:00"), "MMM d")} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11, fill: "hsl(215 20% 55%)" }} tickFormatter={(v) => `${v}`} />
                <Tooltip
                  contentStyle={{ background: "hsl(222 44% 14%)", border: "1px solid hsl(217 32% 22%)", borderRadius: 8, fontSize: 12 }}
                  labelFormatter={(l) => format(new Date(l + "T00:00"), "MMM d, yyyy")}
                  formatter={(v: number) => [`₹${v.toFixed(2)}`, "Sales"]}
                />
                <Area type="monotone" dataKey="total" stroke="hsl(38 92% 55%)" strokeWidth={2} fill="url(#salesGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-56 flex items-center justify-center text-muted-foreground text-sm">No sales data yet</div>
          )}
        </div>

        {/* Top customers with balance */}
        <div className="bg-card border border-card-border rounded-xl p-5">
          <h2 className="text-sm font-semibold text-foreground mb-4">Top Outstanding Balances</h2>
          {topCustomers && topCustomers.length > 0 ? (
            <div className="space-y-3">
              {topCustomers.slice(0, 6).map((c) => (
                <div key={c.id} className="flex items-center justify-between" data-testid={`debtor-${c.id}`}>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground truncate">{c.name}</div>
                    {c.phone && <div className="text-xs text-muted-foreground">{c.phone}</div>}
                  </div>
                  <div className="text-sm font-bold text-amber-400 ml-4 flex-shrink-0">₹{c.outstandingBalance.toFixed(0)}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground text-center py-8">No outstanding balances</div>
          )}
        </div>
      </div>

      {/* Low stock alert panel */}
      {lowStockItems.length > 0 && (
        <div className="bg-card border border-red-500/30 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="w-4 h-4 text-red-400" />
            <h2 className="text-sm font-semibold text-red-400">Low Stock Alert</h2>
            <span className="text-xs text-muted-foreground ml-auto">{lowStockItems.length} product{lowStockItems.length !== 1 ? "s" : ""} need restocking</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {lowStockItems.map((p) => {
              const pct = p.lowStockThreshold > 0 ? Math.min(100, (p.stockQuantity / p.lowStockThreshold) * 100) : 0;
              return (
                <div key={p.id} className="bg-red-500/5 border border-red-500/20 rounded-lg px-4 py-3" data-testid={`low-stock-${p.id}`}>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <div className="text-sm font-medium text-foreground">{p.name}</div>
                      {p.category && <div className="text-xs text-muted-foreground">{p.category}</div>}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className={cn("text-sm font-bold", p.stockQuantity === 0 ? "text-red-400" : "text-amber-400")}>
                        {p.stockQuantity === 0 ? "OUT" : `${p.stockQuantity} ${p.unit}`}
                      </div>
                      <div className="text-xs text-muted-foreground">min {p.lowStockThreshold}</div>
                    </div>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className={cn("h-full rounded-full", p.stockQuantity === 0 ? "bg-red-500" : "bg-amber-400")}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent activity */}
      <div className="bg-card border border-card-border rounded-xl p-5">
        <h2 className="text-sm font-semibold text-foreground mb-4">Recent Activity</h2>
        {loadingActivity ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-10 bg-muted rounded-lg animate-pulse" />
            ))}
          </div>
        ) : activity && activity.length > 0 ? (
          <div className="space-y-1">
            {activity.map((item) => (
              <div key={item.id} className="flex items-center gap-4 py-2.5 px-3 rounded-lg hover:bg-accent/50 transition-colors" data-testid={`activity-${item.id}`}>
                <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${item.type === "sale" ? "bg-primary/20 text-primary" : item.type === "payment" ? "bg-emerald-500/20 text-emerald-400" : "bg-blue-500/20 text-blue-400"}`}>
                  {item.type === "sale" ? <ShoppingCart className="w-3.5 h-3.5" /> : item.type === "payment" ? <CreditCard className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-foreground truncate">{item.description}</div>
                  <div className="text-xs text-muted-foreground">{format(new Date(item.createdAt), "MMM d, h:mm a")}</div>
                </div>
                {item.amount != null && (
                  <div className="text-sm font-semibold text-foreground flex-shrink-0">₹{item.amount.toFixed(2)}</div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground text-center py-8">No activity yet. Start by recording a sale.</div>
        )}
      </div>
    </div>
  );
}
