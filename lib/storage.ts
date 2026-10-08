/**
 * Temporary browser-side persistence. Only non-sensitive checking data is stored here:
 * numbers, results, settings and UI state. No WhatsApp credentials ever reach the browser.
 */
import type { NumberEntry, PrepStats } from "./prepare";
import type { CheckStatus, SingleCheckResponse } from "./types";

const SESSION_KEY = "wac.session.v1";
const CACHE_KEY = "wac.cache.v1";

export type Mode = "single" | "bulk" | "csv";
export type RunStatus = "idle" | "running" | "paused" | "stopped" | "completed";

export interface RunState {
  status: RunStatus;
  jobId: string | null;
  jobCursor: number;
  startedAt: number | null;
}

export interface CsvState {
  fileName: string;
  headers: string[];
  /** Raw rows kept so the phone column can be changed; dropped if too large to store. */
  rows: string[][] | null;
  column: number;
  columnDetected: boolean;
  truncated: boolean;
}

export interface Settings {
  ttlHours: number;
  reuseCache: boolean;
}

export interface SessionData {
  lastActivity: number;
  mode: Mode;
  bulkText: string;
  single: { input: string; result: SingleCheckResponse | null };
  list: { source: "bulk" | "csv" | null; entries: NumberEntry[]; stats: PrepStats | null; truncated: boolean };
  csv: CsvState | null;
  run: RunState;
  settings: Settings;
}

export const emptyRun = (): RunState => ({ status: "idle", jobId: null, jobCursor: 0, startedAt: null });

// ── compact entry encoding ─────────────────────────────────────────────
const STATUS_CODES: Record<CheckStatus, string> = {
  available: "a",
  not_available: "n",
  invalid: "i",
  error: "e",
  pending: "p",
};
const STATUS_FROM_CODE = Object.fromEntries(Object.entries(STATUS_CODES).map(([k, v]) => [v, k])) as Record<
  string,
  CheckStatus
>;

type PackedEntry = [string, string | null, string, number | 0, number | 0, string | 0, 0 | 1];

function packEntry(e: NumberEntry): PackedEntry {
  return [e.original, e.normalized, STATUS_CODES[e.status], e.checkedAt ?? 0, e.row ?? 0, e.reason ?? 0, e.cached ? 1 : 0];
}

function unpackEntry(p: PackedEntry, i: number): NumberEntry {
  const [original, normalized, code, checkedAt, row, reason, cached] = p;
  return {
    id: i + 1,
    original: String(original ?? ""),
    normalized: normalized ?? null,
    status: STATUS_FROM_CODE[code] ?? "pending",
    ...(checkedAt ? { checkedAt } : {}),
    ...(row ? { row } : {}),
    ...(reason ? { reason: String(reason) } : {}),
    ...(cached ? { cached: true } : {}),
  };
}

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function safeRemove(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function isExpired(lastActivity: number, ttlHours: number): boolean {
  return !Number.isFinite(lastActivity) || Date.now() - lastActivity > ttlHours * 3_600_000;
}

/** Load the stored session, discarding it if it has expired or is unreadable. */
export function loadSession(defaultTtlHours: number): SessionData | null {
  const raw = safeGet(SESSION_KEY);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    const ttl = Number(data?.settings?.ttlHours) || defaultTtlHours;
    if (isExpired(Number(data?.lastActivity), ttl)) {
      clearAllStorage();
      return null;
    }
    const entries: NumberEntry[] = Array.isArray(data.list?.entries)
      ? (data.list.entries as PackedEntry[]).map(unpackEntry)
      : [];
    return { ...data, list: { ...data.list, entries } } as SessionData;
  } catch {
    clearAllStorage();
    return null;
  }
}

export type SaveResult = "ok" | "reduced" | "failed";

/** Persist the session; drops the raw CSV rows (then entries) when the browser quota is hit. */
export function saveSession(data: SessionData): SaveResult {
  const packed = { ...data, list: { ...data.list, entries: data.list.entries.map(packEntry) } };
  if (safeSet(SESSION_KEY, JSON.stringify(packed))) return "ok";
  const withoutRows = { ...packed, csv: packed.csv ? { ...packed.csv, rows: null } : null };
  if (safeSet(SESSION_KEY, JSON.stringify(withoutRows))) return "reduced";
  return "failed";
}

// ── result cache (number → last known status) ───────────────────────────
type CacheMap = Record<string, [code: "a" | "n", at: number]>;

export function loadCache(ttlHours: number): Map<string, { status: "available" | "not_available"; at: number }> {
  const out = new Map<string, { status: "available" | "not_available"; at: number }>();
  const raw = safeGet(CACHE_KEY);
  if (!raw) return out;
  try {
    const data = JSON.parse(raw) as CacheMap;
    for (const [n, [code, at]] of Object.entries(data)) {
      if (!isExpired(at, ttlHours)) out.set(n, { status: code === "a" ? "available" : "not_available", at });
    }
  } catch {
    safeRemove(CACHE_KEY);
  }
  return out;
}

export function saveCache(cache: Map<string, { status: "available" | "not_available"; at: number }>) {
  const data: CacheMap = {};
  for (const [n, v] of cache) data[n] = [v.status === "available" ? "a" : "n", v.at];
  if (!safeSet(CACHE_KEY, JSON.stringify(data))) safeRemove(CACHE_KEY);
}

export function clearAllStorage() {
  safeRemove(SESSION_KEY);
  safeRemove(CACHE_KEY);
}
