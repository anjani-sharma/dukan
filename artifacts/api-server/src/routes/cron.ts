import { Router } from "express";
import { sendDailyReport, sendWeeklyReport } from "../scheduler";
import { logger } from "../lib/logger";

const router = Router();

function checkSecret(req: { headers: Record<string, string | string[] | undefined> }): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers["x-cron-secret"] === secret;
}

router.post("/cron/daily-report", async (req, res) => {
  if (!checkSecret(req)) return res.status(401).json({ error: "Unauthorized" });
  try {
    await sendDailyReport();
    logger.info("Daily report triggered via HTTP");
    return res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Daily report trigger failed");
    return res.status(500).json({ error: String(err) });
  }
});

router.post("/cron/weekly-report", async (req, res) => {
  if (!checkSecret(req)) return res.status(401).json({ error: "Unauthorized" });
  try {
    await sendWeeklyReport();
    logger.info("Weekly report triggered via HTTP");
    return res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Weekly report trigger failed");
    return res.status(500).json({ error: String(err) });
  }
});

export default router;
