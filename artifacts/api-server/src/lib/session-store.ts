import { logger } from "./logger";

export const COOKIE_NAME = "dukan_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// token → expiry timestamp
export const sessions = new Map<string, number>();

export function createSession(token: string): void {
  sessions.set(token, Date.now() + SESSION_TTL_MS);
}

export function validateSession(token: string): boolean {
  const expiry = sessions.get(token);
  if (!expiry) return false;
  if (Date.now() > expiry) {
    sessions.delete(token);
    return false;
  }
  return true;
}

export function deleteSession(token: string): void {
  sessions.delete(token);
}

export function getShopPassword(): string {
  const pw = process.env["SHOP_PASSWORD"];
  if (!pw) {
    logger.warn("SHOP_PASSWORD env var not set — using default password. Set it before going live!");
    return "admin1234";
  }
  return pw;
}
