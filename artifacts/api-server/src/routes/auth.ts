import { Router } from "express";
import crypto from "node:crypto";
import { COOKIE_NAME, createSession, deleteSession, validateSession, getShopPassword } from "../lib/session-store";

const router = Router();

const isProd = process.env.NODE_ENV === "production";

function cookieOptions(maxAge?: number) {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: (isProd ? "none" : "lax") as "none" | "lax",
    path: "/",
    ...(maxAge !== undefined ? { maxAge } : {}),
  };
}

function timingSafeCompare(a: string, b: string): boolean {
  // Lengths differ → definitely wrong, but still run a comparison to avoid timing leak
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    // Compare against itself to consume constant time
    crypto.timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
}

router.post("/auth/login", (req, res) => {
  const { password } = req.body as { password?: string };

  if (!password || !timingSafeCompare(password, getShopPassword())) {
    res.status(401).json({ error: "Incorrect password" });
    return;
  }

  const token = crypto.randomBytes(32).toString("hex");
  createSession(token);

  res.cookie(COOKIE_NAME, token, cookieOptions(7 * 24 * 60 * 60 * 1000));
  res.json({ ok: true });
});

router.post("/auth/logout", (req, res) => {
  const token = (req.cookies as Record<string, string>)[COOKIE_NAME];
  if (token) deleteSession(token);
  res.clearCookie(COOKIE_NAME, cookieOptions());
  res.json({ ok: true });
});

router.get("/auth/me", (req, res) => {
  const token = (req.cookies as Record<string, string>)[COOKIE_NAME];
  if (!token || !validateSession(token)) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  res.json({ ok: true });
});

export default router;
