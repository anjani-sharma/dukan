import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="text-6xl font-bold text-primary mb-4">404</div>
        <h1 className="text-xl font-semibold text-foreground mb-2">Page not found</h1>
        <p className="text-muted-foreground mb-6">The page you are looking for does not exist.</p>
        <Link href="/">
          <Button>Go to Dashboard</Button>
        </Link>
      </div>
    </div>
  );
}
