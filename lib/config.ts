/** Public (browser-safe) configuration. Never put secrets here. */
function num(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = value ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

export const publicConfig = {
  maxCsvBytes: num(process.env.NEXT_PUBLIC_MAX_CSV_MB, 5, 0.1, 50) * 1024 * 1024,
  maxNumbers: Math.floor(num(process.env.NEXT_PUBLIC_MAX_NUMBERS, 20_000, 1, 200_000)),
  sessionTtlHours: num(process.env.NEXT_PUBLIC_SESSION_TTL_HOURS, 24, 1, 24 * 30),
};
