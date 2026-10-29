import "dotenv/config";

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") throw new Error(`Missing required environment variable ${name}`);
  return v;
}

const nodeEnv = process.env.NODE_ENV ?? "development";
const isTest = nodeEnv === "test";

export const config = {
  nodeEnv,
  isProduction: nodeEnv === "production",
  isTest,
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: isTest ? required("TEST_DATABASE_URL") : required("DATABASE_URL"),
  sessionSecret: (() => {
    const s = required("SESSION_SECRET", isTest ? "test-session-secret-not-for-production" : undefined);
    if (nodeEnv === "production" && s.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters in production");
    return s;
  })(),
  sessionTtlMinutes: Number(process.env.SESSION_TTL_MINUTES ?? 480),
  appOrigin: process.env.APP_ORIGIN ?? "http://localhost:5173",
  trustProxy: process.env.TRUST_PROXY === "true",
  uploadDir: process.env.UPLOAD_DIR ?? "./uploads",
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB ?? 5) * 1024 * 1024,
  timezone: "Asia/Manila",
};
