import crypto from "node:crypto";
import { logger } from "./logger";

export const COOKIE_NAME = "dukan_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function getSecret(): string {
  const s = process.env["SESSION_SECRET"];
  if (!s) {
    logger.warn("SESSION_SECRET not set — using insecure default. Set it in production!");
    return "default-insecure-secret-change-me";
  }
  return s;
}

// token format: <expiresAt(ms)>.<hmac-sha256-hex>
export function createSession(_token: string): void {
  // no-op: token is generated in auth route, not stored here
}

export function makeSessionToken(): string {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const payload = String(expiresAt);
  const sig = crypto.createHmac("sha256", getSecret()).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

export function validateSession(token: string): boolean {
  const dot = token.lastIndexOf(".");
  if (dot === -1) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac("sha256", getSecret()).update(payload).digest("hex");
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  const expiresAt = Number(payload);
  return Number.isFinite(expiresAt) && Date.now() < expiresAt;
}

// Logout is handled by clearing the cookie — no server-side state to remove
export function deleteSession(_token: string): void {}

export function getShopPassword(): string {
  const pw = process.env["SHOP_PASSWORD"];
  if (!pw) {
    logger.warn("SHOP_PASSWORD env var not set — using default password. Set it before going live!");
    return "admin1234";
  }
  return pw;
}
