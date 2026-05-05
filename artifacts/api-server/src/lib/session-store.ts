import { db, sessionsTable } from "@workspace/db";
import { eq, lt } from "drizzle-orm";
import { logger } from "./logger";

export const COOKIE_NAME = "dukan_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export async function createSession(token: string): Promise<void> {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  await db.insert(sessionsTable).values({ token, expiresAt });
  // Clean up expired sessions opportunistically
  db.delete(sessionsTable).where(lt(sessionsTable.expiresAt, Date.now())).catch(() => {});
}

export async function validateSession(token: string): Promise<boolean> {
  const rows = await db.select().from(sessionsTable).where(eq(sessionsTable.token, token));
  if (!rows.length) return false;
  if (Date.now() > rows[0].expiresAt) {
    await db.delete(sessionsTable).where(eq(sessionsTable.token, token));
    return false;
  }
  return true;
}

export async function deleteSession(token: string): Promise<void> {
  await db.delete(sessionsTable).where(eq(sessionsTable.token, token));
}

export function getShopPassword(): string {
  const pw = process.env["SHOP_PASSWORD"];
  if (!pw) {
    logger.warn("SHOP_PASSWORD env var not set — using default password. Set it before going live!");
    return "admin1234";
  }
  return pw;
}
