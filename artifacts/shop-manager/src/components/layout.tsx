import { Link, useLocation } from "wouter";
import { LayoutDashboard, ShoppingCart, Users, Package, FileText, BarChart2, Store, ShoppingBag, Menu, X, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { QuickEntry } from "./quick-entry";
import { useState } from "react";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/sales", label: "Sales", icon: ShoppingCart },
  { href: "/purchases", label: "Purchases", icon: ShoppingBag },
  { href: "/customers", label: "Customers", icon: Users },
  { href: "/products", label: "Products", icon: Package },
  { href: "/invoices", label: "Invoices", icon: FileText },
  { href: "/analytics", label: "Analytics", icon: BarChart2 },
  { href: "/vendors", label: "Vendors", icon: Store },
];

// Bottom nav shows only the most-used 5 items; rest accessible via "More" drawer
const bottomNavItems = [
  { href: "/", label: "Home", icon: LayoutDashboard },
  { href: "/sales", label: "Sales", icon: ShoppingCart },
  { href: "/customers", label: "Customers", icon: Users },
  { href: "/products", label: "Products", icon: Package },
  { href: "/purchases", label: "Purchases", icon: ShoppingBag },
];

export function Layout({ children, onLogout }: { children: React.ReactNode; onLogout?: () => void }) {
  const [location] = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <>
      <div className="flex h-screen bg-background overflow-hidden">
        {/* ── Desktop Sidebar (hidden on mobile) ── */}
        <aside className="hidden md:flex w-56 flex-shrink-0 bg-sidebar border-r border-sidebar-border flex-col">
          <div className="px-5 py-5 border-b border-sidebar-border">
            <div
              className="text-3xl font-black text-primary leading-none"
              style={{ fontFamily: "'Noto Sans Devanagari', 'Mangal', sans-serif", letterSpacing: "-0.5px" }}
            >
              दोकाने
            </div>
            <div className="text-[10px] font-semibold text-muted-foreground mt-1.5 tracking-widest uppercase">
              RK Enterprises
            </div>
          </div>

          <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
            {navItems.map(({ href, label, icon: Icon }) => {
              const active = href === "/" ? location === "/" : location.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  )}
                  data-testid={`nav-${label.toLowerCase()}`}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  {label}
                </Link>
              );
            })}
          </nav>

          <div className="px-4 py-4 border-t border-sidebar-border space-y-2">
            <div>
              <div className="text-xs text-muted-foreground">Also available on Telegram</div>
              <div className="text-xs text-primary mt-0.5 font-medium">Send voice or invoice photos</div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <img src="/ai-transformers-logo.png" alt="AI Transformers" className="w-5 h-5 rounded-sm opacity-70" />
                <div className="text-xs text-muted-foreground/50 leading-tight">Powered by AI Transformers LTD</div>
              </div>
              {onLogout && (
                <button
                  onClick={onLogout}
                  className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-colors"
                  title="Sign out"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </aside>

        {/* ── Mobile top header (hidden on desktop) ── */}
        <div className="md:hidden fixed top-0 left-0 right-0 z-30 bg-sidebar border-b border-sidebar-border flex items-center justify-between px-4 py-3">
          <div>
            <div
              className="text-2xl font-black text-primary leading-none"
              style={{ fontFamily: "'Noto Sans Devanagari', 'Mangal', sans-serif" }}
            >
              दोकाने
            </div>
            <div className="text-[9px] font-semibold text-muted-foreground tracking-widest uppercase leading-none mt-0.5">
              RK Enterprises
            </div>
          </div>
          <button
            onClick={() => setDrawerOpen(true)}
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-colors"
            aria-label="More navigation"
          >
            <Menu className="w-5 h-5" />
          </button>
        </div>

        {/* ── Mobile full-screen drawer ── */}
        {drawerOpen && (
          <div className="md:hidden fixed inset-0 z-50">
            <div className="absolute inset-0 bg-black/60" onClick={() => setDrawerOpen(false)} />
            <div className="absolute top-0 right-0 bottom-0 w-64 bg-sidebar border-l border-sidebar-border flex flex-col">
              <div className="flex items-center justify-between px-5 py-4 border-b border-sidebar-border">
                <span className="text-sm font-semibold text-foreground">Menu</span>
                <button onClick={() => setDrawerOpen(false)} className="p-1 rounded text-muted-foreground hover:text-foreground">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
                {navItems.map(({ href, label, icon: Icon }) => {
                  const active = href === "/" ? location === "/" : location.startsWith(href);
                  return (
                    <Link
                      key={href}
                      href={href}
                      onClick={() => setDrawerOpen(false)}
                      className={cn(
                        "flex items-center gap-3 px-3 py-3 rounded-md text-sm font-medium transition-colors",
                        active
                          ? "bg-primary text-primary-foreground"
                          : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                      )}
                    >
                      <Icon className="w-5 h-5 flex-shrink-0" />
                      {label}
                    </Link>
                  );
                })}
              </nav>
              <div className="px-4 py-4 border-t border-sidebar-border space-y-3">
                <div className="flex items-center gap-1.5">
                  <img src="/ai-transformers-logo.png" alt="AI Transformers" className="w-4 h-4 rounded-sm opacity-60" />
                  <div className="text-xs text-muted-foreground/50">Powered by AI Transformers LTD</div>
                </div>
                {onLogout && (
                  <button
                    onClick={onLogout}
                    className="flex items-center gap-2 w-full px-3 py-2 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    Sign out
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Main content ── */}
        <main className="flex-1 overflow-auto pt-[56px] pb-16 md:pt-0 md:pb-0">
          {children}
        </main>
      </div>

      {/* ── Mobile bottom nav bar (hidden on desktop) ── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-sidebar border-t border-sidebar-border flex items-stretch h-14">
        {bottomNavItems.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? location === "/" : location.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors",
                active ? "text-primary" : "text-muted-foreground"
              )}
            >
              <Icon className={cn("w-5 h-5", active && "drop-shadow-[0_0_6px_hsl(38_92%_55%/0.6)]")} />
              {label}
            </Link>
          );
        })}
      </nav>

      <QuickEntry />
    </>
  );
}
