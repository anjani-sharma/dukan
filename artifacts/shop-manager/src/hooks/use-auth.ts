import { useState, useEffect } from "react";

const apiBase = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, "") ?? "";

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${apiBase}${path}`, { ...init, credentials: "include" });
}

export type AuthState = "loading" | "authenticated" | "unauthenticated";

export function useAuth() {
  const [state, setState] = useState<AuthState>("loading");
  const [error, setError] = useState<string>();
  const [loginLoading, setLoginLoading] = useState(false);

  useEffect(() => {
    apiFetch("/api/auth/me")
      .then((res) => setState(res.ok ? "authenticated" : "unauthenticated"))
      .catch(() => setState("unauthenticated"));
  }, []);

  const login = async (password: string) => {
    setLoginLoading(true);
    setError(undefined);
    try {
      const res = await apiFetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        setState("authenticated");
      } else {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? "Login failed");
      }
    } catch {
      setError("Network error — could not reach server");
    } finally {
      setLoginLoading(false);
    }
  };

  const logout = async () => {
    await apiFetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    setState("unauthenticated");
  };

  return { state, error, loginLoading, login, logout };
}
