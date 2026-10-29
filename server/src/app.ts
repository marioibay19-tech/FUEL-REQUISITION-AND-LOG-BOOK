import connectPgSimple from "connect-pg-simple";
import express, { type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import session from "express-session";
import helmet from "helmet";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { config } from "./config.js";
import { Prisma } from "./db.js";
import { HttpError } from "./lib/errors.js";
import { attachUser, requireAuth } from "./middleware/auth.js";
import { apiRouter } from "./routes/index.js";
import { authRouter } from "./routes/auth.js";

export function createApp(opts: { staticDir?: string } = {}) {
  const app = express();
  if (config.trustProxy) app.set("trust proxy", 1);
  app.disable("x-powered-by");

  // Decimals are sent to the client as numbers (Prisma serialises them as strings by default).
  app.set("json replacer", function (this: Record<string, unknown>, key: string, value: unknown) {
    const orig = this[key];
    if (orig instanceof Prisma.Decimal) return orig.toNumber();
    if (typeof orig === "bigint") return orig.toString();
    return value;
  });

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "blob:"],
          fontSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
    }),
  );
  app.use(express.json({ limit: "200kb" }));

  const PgStore = connectPgSimple(session);
  const pool = new pg.Pool({ connectionString: config.databaseUrl.replace(/\?schema=\w+$/, "") });
  app.use(
    session({
      name: "fueltrack.sid",
      store: new PgStore({ pool, tableName: "session", createTableIfMissing: false, pruneSessionInterval: config.isTest ? false : 15 * 60 }),
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        sameSite: "strict",
        secure: config.isProduction && config.trustProxy,
        maxAge: config.sessionTtlMinutes * 60 * 1000,
      },
    }),
  );

  // CSRF protection: state-changing requests must carry a custom header, which
  // browsers only allow from same-origin scripts (cross-site forms cannot set it).
  app.use("/api", (req: Request, _res: Response, next: NextFunction) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    if (req.get("X-Requested-With") !== "FuelTrack") return next(new HttpError(403, "Request blocked (missing anti-forgery header)"));
    next();
  });

  app.use("/api", attachUser);
  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: config.isTest ? 1000 : 30, standardHeaders: true, legacyHeaders: false });
  app.use("/api/auth/login", loginLimiter);
  app.use("/api/auth", authRouter);
  app.use("/api", rateLimit({ windowMs: 60 * 1000, limit: config.isTest ? 100000 : 600, standardHeaders: true, legacyHeaders: false }));
  app.use("/api", requireAuth, apiRouter);
  app.use("/api", (_req, _res, next) => next(new HttpError(404, "Not found")));

  // Production: serve the built client and fall back to index.html for client routes.
  if (opts.staticDir && fs.existsSync(opts.staticDir)) {
    app.use(express.static(opts.staticDir, { index: false, maxAge: "1h" }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(opts.staticDir!, "index.html")));
  }

  // Safe error handling: details for validation errors, generic text for anything unexpected.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message, code: err.code, details: err.details });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2002") return res.status(409).json({ error: "A record with the same unique value already exists", code: "DUPLICATE", details: err.meta });
      if (err.code === "P2025") return res.status(404).json({ error: "Record not found", code: "NOT_FOUND" });
    }
    const e = err as { type?: string; status?: number; code?: string };
    if (e?.type === "entity.parse.failed") return res.status(400).json({ error: "Malformed JSON body" });
    if (e?.code === "LIMIT_FILE_SIZE") return res.status(400).json({ error: `File is larger than ${config.maxUploadBytes / 1024 / 1024} MB` });
    console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`, err);
    res.status(500).json({ error: "An unexpected error occurred. Please try again or contact the administrator." });
  });

  return app;
}
