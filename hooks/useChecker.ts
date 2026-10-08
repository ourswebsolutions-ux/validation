"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { api, ApiRequestError } from "@/lib/api-client";
import { publicConfig } from "@/lib/config";
import { CsvError, parseCsvText, type ColumnAnalysis } from "@/lib/csv";
import { normalizePhoneNumber, splitNumberList } from "@/lib/phone-number";
import { prepareNumbers, type NumberEntry, type RawNumber } from "@/lib/prepare";
import {
  clearAllStorage,
  emptyRun,
  loadCache,
  loadSession,
  saveCache,
  saveSession,
  type Mode,
  type RunState,
  type SessionData,
} from "@/lib/storage";
import type { JobResultItem, JobState, SingleCheckResponse } from "@/lib/types";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
type CacheEntry = { status: "available" | "not_available"; at: number };

function defaultSession(): SessionData {
  return {
    lastActivity: Date.now(),
    mode: "single",
    bulkText: "",
    single: { input: "", result: null },
    list: { source: null, entries: [], stats: null, truncated: false },
    csv: null,
    run: emptyRun(),
    settings: { ttlHours: publicConfig.sessionTtlHours, reuseCache: true },
  };
}

export interface PendingCsv {
  fileName: string;
  headers: string[];
  rows: string[][];
  truncated: boolean;
  analysis: ColumnAnalysis;
  /** Column to pre-select in the picker (null = user must choose). */
  initialColumn: number | null;
}

export interface Counts {
  total: number;
  valid: number;
  invalid: number;
  pending: number;
  checked: number;
  available: number;
  notAvailable: number;
  errors: number;
}

export interface ProgressInfo {
  /** Server-side job state of the current chunk, if any. */
  jobState: JobState | null;
  etaSeconds: number | null;
  issue: string | null;
}

export function useChecker(opts: { maxPerRequest: number; isConnected: () => boolean; onNeedConnection: () => void }) {
  const [data, setData] = useState<SessionData>(() => loadSession(publicConfig.sessionTtlHours) ?? defaultSession());
  const dataRef = useRef(data);
  const cacheRef = useRef<Map<string, CacheEntry> | null>(null);
  const loopActive = useRef(false);
  const samples = useRef<{ t: number; n: number }[]>([]);
  const optsRef = useRef(opts);
  const [progress, setProgress] = useState<ProgressInfo>({ jobState: null, etaSeconds: null, issue: null });
  const [busy, setBusy] = useState<null | "single" | "prepare">(null);

  useEffect(() => {
    optsRef.current = opts;
  }, [opts]);

  const getCache = useCallback(() => {
    if (!cacheRef.current) cacheRef.current = loadCache(dataRef.current.settings.ttlHours);
    return cacheRef.current;
  }, []);

  /** Synchronous state update: the ref is always current, so the async runner never reads stale data. */
  const update = useCallback((fn: (d: SessionData) => SessionData) => {
    const next = { ...fn(dataRef.current), lastActivity: Date.now() };
    dataRef.current = next;
    setData(next);
  }, []);

  const setRun = useCallback(
    (patch: Partial<RunState>) => update((d) => ({ ...d, run: { ...d.run, ...patch } })),
    [update],
  );

  // ── persistence (debounced) ───────────────────────────────────────────
  const warnedQuota = useRef(false);
  useEffect(() => {
    const t = setTimeout(() => {
      const result = saveSession(data);
      if (result !== "ok" && !warnedQuota.current) {
        warnedQuota.current = true;
        toast.warning(
          result === "reduced"
            ? "The CSV is large, so only the numbers and results are saved in this browser."
            : "This list is too large to save in the browser. Results will be lost if you refresh.",
        );
      }
    }, 600);
    return () => clearTimeout(t);
  }, [data]);

  // ── automatic expiry ─────────────────────────────────────────────────
  useEffect(() => {
    const timer = setInterval(() => {
      const d = dataRef.current;
      const running = d.run.status === "running" || d.run.status === "paused";
      if (!running && Date.now() - d.lastActivity > d.settings.ttlHours * 3_600_000) {
        clearAllStorage();
        cacheRef.current = new Map();
        const fresh = defaultSession();
        dataRef.current = fresh;
        setData(fresh);
        toast.info("Temporary session data expired and was cleared.");
      }
    }, 60_000);
    return () => clearInterval(timer);
  }, []);

  // ── counts ───────────────────────────────────────────────────────────
  const counts: Counts = useMemo(() => {
    const c: Counts = { total: 0, valid: 0, invalid: 0, pending: 0, checked: 0, available: 0, notAvailable: 0, errors: 0 };
    for (const e of data.list.entries) {
      c.total++;
      if (e.status === "invalid") c.invalid++;
      else c.valid++;
      if (e.status === "pending") c.pending++;
      else if (e.status === "available") c.available++;
      else if (e.status === "not_available") c.notAvailable++;
      else if (e.status === "error") c.errors++;
    }
    c.checked = c.available + c.notAvailable + c.errors;
    return c;
  }, [data.list.entries]);

  // ── result application ───────────────────────────────────────────────
  const applyResults = useCallback(
    (results: JobResultItem[]) => {
      if (results.length === 0) return;
      const cache = getCache();
      update((d) => {
        const index = new Map<string, number>();
        d.list.entries.forEach((e, i) => {
          if (e.normalized) index.set(e.normalized, i);
        });
        const entries = d.list.entries.slice();
        for (const r of results) {
          const i = index.get(r.number);
          if (i === undefined) continue;
          entries[i] = {
            ...entries[i],
            status: r.status,
            checkedAt: r.checkedAt,
            cached: false,
            ...(r.error ? { reason: r.error } : { reason: undefined }),
          };
          if (r.status !== "error") cache.set(r.number, { status: r.status, at: r.checkedAt });
        }
        return { ...d, list: { ...d.list, entries } };
      });
      saveCache(cache);

      // Rolling throughput sample for the ETA.
      const now = Date.now();
      const checked = dataRef.current.list.entries.filter((e) => e.status !== "pending" && e.status !== "invalid").length;
      samples.current.push({ t: now, n: checked });
      samples.current = samples.current.filter((s) => now - s.t < 90_000);
      const first = samples.current[0];
      const remaining = dataRef.current.list.entries.filter((e) => e.status === "pending").length;
      if (first && now - first.t > 5000 && checked > first.n) {
        const rate = (checked - first.n) / ((now - first.t) / 1000);
        setProgress((p) => ({ ...p, etaSeconds: Math.round(remaining / rate) }));
      }
    },
    [getCache, update],
  );

  /** Fill pending entries from the browser cache; returns the numbers that still need checking. */
  const applyCache = useCallback((): string[] => {
    const d = dataRef.current;
    const cache = getCache();
    const remaining: string[] = [];
    let hits = 0;
    const entries = d.list.entries.map((e): NumberEntry => {
      if (e.status !== "pending" || !e.normalized) return e;
      const hit = d.settings.reuseCache ? cache.get(e.normalized) : undefined;
      if (hit) {
        hits++;
        return { ...e, status: hit.status, checkedAt: hit.at, cached: true, reason: undefined };
      }
      remaining.push(e.normalized);
      return e;
    });
    if (hits > 0) update((s) => ({ ...s, list: { ...s.list, entries } }));
    return remaining;
  }, [getCache, update]);

  // ── bulk runner ──────────────────────────────────────────────────────
  const runLoop = useCallback(async () => {
    if (loopActive.current) return;
    loopActive.current = true;
    let failures = 0;
    try {
      for (;;) {
        const run = dataRef.current.run;
        if (run.status !== "running" && run.status !== "paused") break;
        try {
          if (!run.jobId) {
            if (run.status === "paused") break;
            const remaining = applyCache();
            if (remaining.length === 0) {
              setRun({ status: "completed", jobId: null, jobCursor: 0 });
              setProgress({ jobState: null, etaSeconds: null, issue: null });
              toast.success("Checking complete.");
              break;
            }
            const chunk = remaining.slice(0, Math.max(1, optsRef.current.maxPerRequest));
            const job = await api.createJob(chunk);
            // Mark anything the server considered invalid so it is not resubmitted forever.
            if (job.invalid.length) {
              const bad = new Set(job.invalid);
              update((d) => ({
                ...d,
                list: {
                  ...d.list,
                  entries: d.list.entries.map((e) =>
                    e.normalized && bad.has(e.normalized) ? { ...e, status: "invalid", reason: "Rejected by server" } : e,
                  ),
                },
              }));
            }
            setRun({ jobId: job.jobId, jobCursor: 0 });
            if (dataRef.current.run.status === "paused") await api.jobAction(job.jobId, "pause").catch(() => undefined);
            failures = 0;
            continue;
          }

          const res = await api.job(run.jobId, run.jobCursor);
          failures = 0;
          applyResults(res.results);
          setRun({ jobCursor: res.nextCursor });
          setProgress((p) => ({ ...p, jobState: res.state, issue: null }));
          if (res.nextCursor < res.processed) continue; // more results to page through
          if (res.state === "completed" || res.state === "stopped") {
            setRun({ jobId: null, jobCursor: 0 });
            continue;
          }
        } catch (err) {
          const e = err instanceof ApiRequestError ? err : null;
          if (e?.status === 404) {
            // Server restarted or job expired: unchecked numbers are simply resubmitted.
            setRun({ jobId: null, jobCursor: 0 });
            continue;
          }
          failures++;
          const wait = e?.retryAfterSec ? e.retryAfterSec * 1000 : Math.min(20_000, 1000 * 2 ** failures);
          setProgress((p) => ({ ...p, issue: e?.message ?? "Unexpected error. Retrying…" }));
          await sleep(wait);
          continue;
        }
        await sleep(dataRef.current.run.status === "paused" ? 3000 : 1500);
      }
    } finally {
      loopActive.current = false;
    }
  }, [applyCache, applyResults, setRun, update]);

  // Resume an interrupted run after a page refresh.
  useEffect(() => {
    const s = dataRef.current.run.status;
    if (s === "running" || s === "paused") void runLoop();
  }, [runLoop]);

  const start = useCallback(() => {
    const d = dataRef.current;
    if (!d.list.entries.some((e) => e.status === "pending")) {
      toast.info("There are no numbers waiting to be checked.");
      return;
    }
    if (!optsRef.current.isConnected()) {
      toast.error("Connect WhatsApp first — scan the QR code in the connection panel.");
      optsRef.current.onNeedConnection();
      return;
    }
    samples.current = [];
    setProgress({ jobState: "queued", etaSeconds: null, issue: null });
    setRun({ status: "running", jobId: null, jobCursor: 0, startedAt: Date.now() });
    void runLoop();
  }, [runLoop, setRun]);

  const pause = useCallback(async () => {
    const { jobId } = dataRef.current.run;
    setRun({ status: "paused" });
    setProgress((p) => ({ ...p, etaSeconds: null }));
    if (jobId) await api.jobAction(jobId, "pause").catch(() => undefined);
  }, [setRun]);

  const resume = useCallback(async () => {
    const { jobId } = dataRef.current.run;
    samples.current = [];
    if (jobId) {
      try {
        await api.jobAction(jobId, "resume");
      } catch (err) {
        if (err instanceof ApiRequestError && err.status === 404) setRun({ jobId: null, jobCursor: 0 });
      }
    }
    setRun({ status: "running" });
    void runLoop();
  }, [runLoop, setRun]);

  const stop = useCallback(async () => {
    const { jobId, jobCursor } = dataRef.current.run;
    setRun({ status: "stopped", jobId: null, jobCursor: 0 });
    setProgress({ jobState: null, etaSeconds: null, issue: null });
    if (jobId) {
      try {
        await api.jobAction(jobId, "stop");
        const last = await api.job(jobId, jobCursor);
        applyResults(last.results);
      } catch {
        /* job may already be gone */
      }
    }
    toast.info("Checking stopped. Unchecked numbers stay pending — you can continue later.");
  }, [applyResults, setRun]);

  // ── list preparation ─────────────────────────────────────────────────
  const isRunning = data.run.status === "running" || data.run.status === "paused";

  const loadList = useCallback(
    async (raws: RawNumber[], source: "bulk" | "csv") => {
      setBusy("prepare");
      try {
        const { entries, stats, truncated } = await prepareNumbers(raws, publicConfig.maxNumbers);
        update((d) => ({ ...d, list: { source, entries, stats, truncated }, run: emptyRun() }));
        setProgress({ jobState: null, etaSeconds: null, issue: null });
        if (truncated) toast.warning(`Only the first ${publicConfig.maxNumbers.toLocaleString()} numbers were loaded.`);
        return { entries, stats };
      } finally {
        setBusy(null);
      }
    },
    [update],
  );

  const prepareBulk = useCallback(async () => {
    const text = dataRef.current.bulkText;
    const tokens = splitNumberList(text);
    if (tokens.length === 0) {
      toast.error("Paste at least one phone number.");
      return null;
    }
    return loadList(
      tokens.map((value) => ({ value })),
      "bulk",
    );
  }, [loadList]);

  const prepareAndStartBulk = useCallback(async () => {
    const res = await prepareBulk();
    if (res && res.stats.valid > 0) start();
    else if (res) toast.error("None of the numbers have a valid format.");
  }, [prepareBulk, start]);

  // ── CSV import: analyze → user confirms a column → import only that column ──
  /** Parsed file awaiting column confirmation (memory only; other columns are never persisted). */
  const [pendingCsv, setPendingCsv] = useState<PendingCsv | null>(null);
  const lastParsed = useRef<PendingCsv | null>(null);

  const importCsv = useCallback(async (file: File) => {
    if (!/\.(csv|txt)$/i.test(file.name) && !/csv|text\/plain|excel/i.test(file.type)) {
      toast.error("Please choose a .csv file.");
      return;
    }
    if (file.size > publicConfig.maxCsvBytes) {
      toast.error(`The file is too large (max ${Math.round(publicConfig.maxCsvBytes / 1024 / 1024)} MB).`);
      return;
    }
    if (file.size === 0) {
      toast.error("The CSV file is empty.");
      return;
    }
    try {
      const text = await file.text();
      const parsed = parseCsvText(text, publicConfig.maxNumbers);
      const pending: PendingCsv = {
        fileName: file.name.replace(/[^\w.\- ()]/g, "_").slice(0, 120),
        headers: parsed.headers,
        rows: parsed.rows,
        truncated: parsed.truncated,
        analysis: parsed.analysis,
        initialColumn: parsed.analysis.selected,
      };
      setPendingCsv(pending);
    } catch (err) {
      toast.error(err instanceof CsvError ? err.message : "Could not read the CSV file.");
    }
  }, []);

  /** Re-open the column picker for the file last imported in this visit. */
  const changeCsvColumn = useCallback(() => {
    const last = lastParsed.current;
    if (!last) {
      toast.error("Please import the CSV file again to change the column.");
      return;
    }
    setPendingCsv({ ...last, initialColumn: dataRef.current.csv?.column ?? last.initialColumn });
  }, []);

  const cancelCsvImport = useCallback(() => setPendingCsv(null), []);

  const confirmCsvImport = useCallback(
    async (column: number) => {
      const pending = pendingCsv;
      if (!pending || column < 0 || column >= pending.headers.length) return;
      setPendingCsv(null);
      lastParsed.current = pending;
      // Only the selected column's values are extracted; everything else is discarded.
      const raws = pending.rows
        .map((r, i) => ({ value: r[column] ?? "", row: i + 1 }))
        .filter((r) => r.value !== "");
      update((d) => ({
        ...d,
        csv: {
          fileName: pending.fileName,
          headers: pending.headers,
          rows: null,
          column,
          columnDetected: true,
          truncated: pending.truncated,
        },
      }));
      const res = await loadList(raws, "csv");
      if (res.stats.valid === 0) toast.warning("No valid phone numbers found in this column.");
      else
        toast.success(
          `Imported ${res.stats.total.toLocaleString()} numbers from “${pending.headers[column]}” · ${res.stats.valid.toLocaleString()} valid.`,
        );
      if (pending.truncated) toast.warning(`Only the first ${publicConfig.maxNumbers.toLocaleString()} rows were imported.`);
    },
    [loadList, pendingCsv, update],
  );

  // ── single number ────────────────────────────────────────────────────
  const checkSingle = useCallback(async () => {
    const { input } = dataRef.current.single;
    const local = normalizePhoneNumber(input);
    const setResult = (result: SingleCheckResponse) =>
      update((d) => ({ ...d, single: { ...d.single, result } }));

    if (!local.valid || !local.e164) {
      setResult({
        number: input,
        normalizedNumber: null,
        country: local.country ?? null,
        countryCode: local.callingCode ?? null,
        status: "invalid",
        checkedAt: Date.now(),
        error: local.reason,
      });
      return;
    }
    const hit = dataRef.current.settings.reuseCache ? getCache().get(local.e164) : undefined;
    if (hit) {
      setResult({ number: input, normalizedNumber: local.e164, status: hit.status, checkedAt: hit.at, cached: true });
      return;
    }
    if (!optsRef.current.isConnected()) {
      toast.error("Connect WhatsApp first — scan the QR code in the connection panel.");
      optsRef.current.onNeedConnection();
      return;
    }
    setBusy("single");
    try {
      const res = await api.checkNumber(local.e164);
      setResult(res);
      if ((res.status === "available" || res.status === "not_available") && res.normalizedNumber) {
        getCache().set(res.normalizedNumber, { status: res.status, at: res.checkedAt });
        saveCache(getCache());
      }
    } catch (err) {
      const message = err instanceof ApiRequestError ? err.message : "Check failed.";
      setResult({ number: input, normalizedNumber: local.e164, status: "error", checkedAt: Date.now(), error: message });
      if (err instanceof ApiRequestError && (err.code === "qr_required" || err.code === "whatsapp_disconnected")) {
        optsRef.current.onNeedConnection();
      }
      toast.error(message);
    } finally {
      setBusy(null);
    }
  }, [getCache, update]);

  // ── simple setters ───────────────────────────────────────────────────
  const setMode = useCallback((mode: Mode) => update((d) => ({ ...d, mode })), [update]);
  const setBulkText = useCallback((bulkText: string) => update((d) => ({ ...d, bulkText })), [update]);
  const setSingleInput = useCallback(
    (input: string) => update((d) => ({ ...d, single: { ...d.single, input } })),
    [update],
  );
  const setReuseCache = useCallback(
    (reuseCache: boolean) => update((d) => ({ ...d, settings: { ...d.settings, reuseCache } })),
    [update],
  );

  const retryErrors = useCallback(() => {
    update((d) => ({
      ...d,
      list: {
        ...d.list,
        entries: d.list.entries.map((e) => (e.status === "error" ? { ...e, status: "pending", reason: undefined } : e)),
      },
    }));
    start();
  }, [start, update]);

  const clearList = useCallback(() => {
    lastParsed.current = null;
    update((d) => ({ ...d, list: { source: null, entries: [], stats: null, truncated: false }, csv: null, run: emptyRun() }));
    setProgress({ jobState: null, etaSeconds: null, issue: null });
  }, [update]);

  const clearSession = useCallback(async () => {
    const { jobId } = dataRef.current.run;
    if (jobId) await api.jobAction(jobId, "stop").catch(() => undefined);
    clearAllStorage();
    cacheRef.current = new Map();
    lastParsed.current = null;
    setPendingCsv(null);
    const fresh = defaultSession();
    dataRef.current = fresh;
    setData(fresh);
    setProgress({ jobState: null, etaSeconds: null, issue: null });
    // The debounced save would re-write the fresh state; remove it once more afterwards.
    setTimeout(clearAllStorage, 700);
  }, []);

  return {
    data,
    counts,
    progress,
    pendingCsv,
    busy,
    isRunning,
    actions: {
      setMode,
      setBulkText,
      setSingleInput,
      setReuseCache,
      checkSingle,
      prepareBulk,
      prepareAndStartBulk,
      importCsv,
      changeCsvColumn,
      cancelCsvImport,
      confirmCsvImport,
      start,
      pause,
      resume,
      stop,
      retryErrors,
      clearList,
      clearSession,
    },
  };
}

export type CheckerApi = ReturnType<typeof useChecker>;
