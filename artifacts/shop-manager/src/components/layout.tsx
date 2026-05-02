import { Link, useLocation } from "wouter";
import { LayoutDashboard, ShoppingCart, Users, Package, FileText, BarChart2, Store, ShoppingBag } from "lucide-react";
import { cn } from "@/lib/utils";
import { QuickEntry } from "./quick-entry";

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

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  return (
    <>
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 bg-sidebar border-r border-sidebar-border flex flex-col">
        <div className="px-5 py-5 border-b border-sidebar-border">
          <div>
            <div className="text-2xl font-black text-primary tracking-tight leading-none">DOKAN</div>
            <div className="text-xs text-muted-foreground mt-1">RK Enterprises · Electrical Shop</div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-0.5">
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
          <div className="text-xs text-muted-foreground/50 leading-tight">
            Powered by AI Transformers LTD
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
    <QuickEntry />
    </>
  );
}
