import { Component, type ReactNode } from "react";

interface Props { children: ReactNode }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center p-8">
          <div className="max-w-md text-center space-y-4">
            <h1 className="text-xl font-semibold text-destructive">Something went wrong</h1>
            <p className="text-sm text-muted-foreground font-mono break-all">
              {this.state.error.message}
            </p>
            <button
              className="text-sm underline text-muted-foreground"
              onClick={() => window.location.reload()}
            >
              Reload page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
