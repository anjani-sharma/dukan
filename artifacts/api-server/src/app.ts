import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { requireAuth } from "./middlewares/require-auth";
import { logger } from "./lib/logger";

const app: Express = express();

// CORS — allow frontend origin with credentials
const rawAllowedOrigins = process.env["FRONTEND_URL"];
const allowedOrigins = rawAllowedOrigins
  ? rawAllowedOrigins.split(",").map((s) => s.trim())
  : null;

app.use(
  cors({
    // In production set FRONTEND_URL; in dev allow any origin (Vite proxy handles same-origin)
    origin: allowedOrigins ?? true,
    credentials: true,
  }),
);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

app.use(cookieParser());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

app.use("/api", requireAuth, router);

// Global error handler — logs full error chain so Render logs show the real cause
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = err instanceof Error ? err.message : String(err);
  const cause = err instanceof Error && (err as NodeJS.ErrnoException).cause;
  logger.error({ err, cause }, `Unhandled error: ${message}`);
  if (!res.headersSent) res.status(500).json({ error: message });
});

export default app;
