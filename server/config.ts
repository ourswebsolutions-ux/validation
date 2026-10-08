import "server-only";
import path from "node:path";

function int(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  const n = raw === undefined || raw === "" ? fallback : Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function resolveAuthDir(): string {
  const configured = process.env.WA_AUTH_DIR?.trim() || "./.wa-session";
  const resolved = path.resolve(/*turbopackIgnore: true*/ process.cwd(), configured);
  const publicDir = path.resolve(/*turbopackIgnore: true*/ process.cwd(), "public");
  if (resolved === publicDir || resolved.startsWith(publicDir + path.sep)) {
    throw new Error("WA_AUTH_DIR must not be inside the public directory.");
  }
  return resolved;
}

let cached: ReturnType<typeof load> | null = null;

function load() {
  return {
    authDir: resolveAuthDir(),
    logLevel: process.env.LOG_LEVEL?.trim() || "warn",
    // Rate settings have conservative floors so they can't be configured into abusive values.
    batchSize: int("CHECK_BATCH_SIZE", 5, 1, 20),
    intervalMs: int("CHECK_INTERVAL_MS", 3000, 1000, 600_000),
    checkTimeoutMs: int("CHECK_TIMEOUT_MS", 20_000, 5_000, 120_000),
    cacheTtlMs: int("CHECK_CACHE_TTL_MS", 3_600_000, 0, 7 * 24 * 3_600_000),
    maxNumbersPerRequest: int("MAX_NUMBERS_PER_REQUEST", 500, 1, 2000),
    maxJobsPerClient: int("MAX_JOBS_PER_CLIENT", 2, 1, 20),
    maxJobsTotal: int("MAX_JOBS_TOTAL", 20, 1, 500),
    rateSinglePerMin: int("RATE_LIMIT_SINGLE_PER_MIN", 20, 1, 1000),
    rateJobsPerMin: int("RATE_LIMIT_JOBS_PER_MIN", 10, 1, 1000),
    rateReadPerMin: int("RATE_LIMIT_READ_PER_MIN", 240, 10, 10_000),
    trustProxy: process.env.TRUST_PROXY === "true",
  };
}

export type ServerConfig = ReturnType<typeof load>;

export function getConfig(): ServerConfig {
  if (!cached) cached = load();
  return cached;
}
