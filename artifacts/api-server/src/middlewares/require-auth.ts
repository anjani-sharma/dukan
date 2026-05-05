import type { Request, Response, NextFunction } from "express";
import { COOKIE_NAME, validateSession } from "../lib/session-store";

const PUBLIC_PATHS = new Set(["/health", "/cron/daily-report", "/cron/weekly-report"]);

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  // Public routes — no auth needed
  if (PUBLIC_PATHS.has(req.path)) {
    next();
    return;
  }

  // Telegram webhook has its own security (bot token in URL / request validation)
  if (req.path === "/telegram/webhook" && req.method === "POST") {
    next();
    return;
  }

  // Auth routes themselves are public
  if (req.path.startsWith("/auth/")) {
    next();
    return;
  }

  const token = (req.cookies as Record<string, string>)[COOKIE_NAME];
  if (!token || !validateSession(token)) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  next();
}
