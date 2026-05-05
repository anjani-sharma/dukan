import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";
import Dashboard from "@/pages/dashboard";
import Sales from "@/pages/sales";
import Purchases from "@/pages/purchases";
import Customers from "@/pages/customers";
import Products from "@/pages/products";
import Invoices from "@/pages/invoices";
import Analytics from "@/pages/analytics";
import VendorPayments from "@/pages/vendor-payments";
import NotFound from "@/pages/not-found";
import LoginPage from "@/pages/login";
import { useAuth } from "@/hooks/use-auth";
import { ErrorBoundary } from "@/components/error-boundary";

// Module-level ref so QueryClient (created once) can call the current logout fn
let _onUnauthorized: (() => void) | null = null;

function is401(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status: number }).status === 401
  );
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => { if (is401(error)) _onUnauthorized?.(); },
  }),
  mutationCache: new MutationCache({
    onError: (error) => { if (is401(error)) _onUnauthorized?.(); },
  }),
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => !is401(error) && failureCount < 1,
      refetchOnWindowFocus: false,
    },
  },
});

function Router({ onLogout }: { onLogout: () => void }) {
  return (
    <Layout onLogout={onLogout}>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/sales" component={Sales} />
        <Route path="/purchases" component={Purchases} />
        <Route path="/customers" component={Customers} />
        <Route path="/products" component={Products} />
        <Route path="/invoices" component={Invoices} />
        <Route path="/analytics" component={Analytics} />
        <Route path="/vendors" component={VendorPayments} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function AuthGate() {
  const { state, error, loginLoading, login, logout } = useAuth();

  // Keep the module-level ref current so QueryClient can trigger logout on 401
  _onUnauthorized = () => {
    queryClient.clear();
    logout();
  };

  if (state === "loading") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground text-sm">Loading…</div>
      </div>
    );
  }

  if (state === "unauthenticated") {
    return <LoginPage onLogin={login} error={error} loading={loginLoading} />;
  }

  return (
    <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <Router onLogout={logout} />
    </WouterRouter>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <AuthGate />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
