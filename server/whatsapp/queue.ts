import "server-only";
import { randomBytes } from "node:crypto";
import { getConfig } from "../config";
import { logger } from "../logger";
import { singleton } from "../singleton";
import type { JobResultItem, JobState, JobStatusResponse } from "@/lib/types";
import { BaileysCheckEngine, EngineUnavailableError, type NumberCheckEngine } from "./checker";
import { getWhatsAppSession } from "./client";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const MAX_BATCH_ATTEMPTS = 3;
const ABANDONED_AFTER_MS = 5 * 60_000; // stop jobs nobody polls anymore
const FINISHED_TTL_MS = 30 * 60_000;
const CACHE_MAX_ENTRIES = 100_000;

export class QueueFullError extends Error {}
export class TimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new TimeoutError("WhatsApp lookup timed out")), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/**
 * Serializes every WhatsApp lookup in the process and enforces a minimum interval between
 * them, so single checks and bulk jobs together never exceed the configured rate.
 */
class RateGate {
  private chain: Promise<unknown> = Promise.resolve();
  private last = 0;

  constructor(private readonly intervalMs: number) {}

  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(async () => {
      const wait = this.last + this.intervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      try {
        return await fn();
      } finally {
        this.last = Date.now();
      }
    });
    this.chain = next.catch(() => undefined);
    return next;
  }
}

/** Short-lived server-side memory of recent answers, so repeated numbers aren't re-queried. */
class ResultCache {
  private map = new Map<string, { exists: boolean; at: number }>();
  constructor(private readonly ttlMs: number) {}

  get(n: string): { exists: boolean; at: number } | null {
    if (this.ttlMs <= 0) return null;
    const hit = this.map.get(n);
    if (!hit) return null;
    if (Date.now() - hit.at > this.ttlMs) {
      this.map.delete(n);
      return null;
    }
    return hit;
  }

  set(n: string, exists: boolean) {
    if (this.ttlMs <= 0) return;
    this.map.delete(n);
    this.map.set(n, { exists, at: Date.now() });
    if (this.map.size > CACHE_MAX_ENTRIES) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }
}

interface Job {
  id: string;
  owner: string;
  numbers: string[];
  next: number;
  attempts: number;
  results: JobResultItem[];
  counts: { available: number; not_available: number; error: number };
  state: JobState;
  createdAt: number;
  updatedAt: number;
  lastPolledAt: number;
  lastServedAt: number;
}

const ACTIVE: JobState[] = ["queued", "running", "waiting_connection"];

export class CheckQueue {
  private jobs = new Map<string, Job>();
  private looping = false;
  private readonly gate: RateGate;
  private readonly cache: ResultCache;

  constructor(private readonly engine: NumberCheckEngine) {
    const cfg = getConfig();
    this.gate = new RateGate(cfg.intervalMs);
    this.cache = new ResultCache(cfg.cacheTtlMs);
    const timer = setInterval(() => this.cleanup(), 60_000);
    timer.unref?.();
  }

  /** Check one E.164 number through the shared rate gate. */
  async checkSingle(number: string): Promise<{ exists: boolean; cached: boolean; at: number }> {
    const hit = this.cache.get(number);
    if (hit) return { exists: hit.exists, cached: true, at: hit.at };
    if (!this.engine.isReady()) throw new EngineUnavailableError();
    const map = await this.gate.run(() => withTimeout(this.engine.check([number]), getConfig().checkTimeoutMs));
    const exists = map.get(number) ?? false;
    this.cache.set(number, exists);
    return { exists, cached: false, at: Date.now() };
  }

  createJob(owner: string, numbers: string[]): Job {
    const cfg = getConfig();
    const active = [...this.jobs.values()].filter((j) => ACTIVE.includes(j.state) || j.state === "paused");
    if (active.length >= cfg.maxJobsTotal) throw new QueueFullError("The checker is busy. Please try again shortly.");
    if (active.filter((j) => j.owner === owner).length >= cfg.maxJobsPerClient) {
      throw new QueueFullError("You already have checks in progress. Wait for them to finish or stop them.");
    }
    const now = Date.now();
    const job: Job = {
      id: randomBytes(12).toString("base64url"),
      owner,
      numbers: [...new Set(numbers)],
      next: 0,
      attempts: 0,
      results: [],
      counts: { available: 0, not_available: 0, error: 0 },
      state: "queued",
      createdAt: now,
      updatedAt: now,
      lastPolledAt: now,
      lastServedAt: 0,
    };
    this.jobs.set(job.id, job);
    this.kick();
    return job;
  }

  getJob(id: string, owner: string): Job | null {
    const job = this.jobs.get(id);
    // Jobs are only visible to the client that created them.
    if (!job || job.owner !== owner) return null;
    job.lastPolledAt = Date.now();
    return job;
  }

  applyAction(job: Job, action: "pause" | "resume" | "stop") {
    if (job.state === "completed" || job.state === "stopped") return;
    if (action === "pause") job.state = "paused";
    else if (action === "resume" && job.state === "paused") job.state = "queued";
    else if (action === "stop") job.state = "stopped";
    job.updatedAt = Date.now();
    if (action === "resume") this.kick();
  }

  toResponse(job: Job, cursor: number): JobStatusResponse {
    const start = Math.min(cursor, job.results.length);
    const results = job.results.slice(start, start + 1000);
    return {
      jobId: job.id,
      state: job.state,
      total: job.numbers.length,
      processed: job.results.length,
      counts: { ...job.counts },
      results,
      nextCursor: start + results.length,
    };
  }

  private kick() {
    if (this.looping) return;
    this.looping = true;
    void this.loop()
      .catch((err) => logger.error({ err: (err as Error).message }, "queue loop crashed"))
      .finally(() => {
        this.looping = false;
        if (this.pickJob()) this.kick();
      });
  }

  private pickJob(): Job | null {
    let best: Job | null = null;
    for (const job of this.jobs.values()) {
      if (!ACTIVE.includes(job.state)) continue;
      if (!best || job.lastServedAt < best.lastServedAt) best = job;
    }
    return best;
  }

  private record(job: Job, number: string, status: JobResultItem["status"], error?: string) {
    job.results.push({ number, status, checkedAt: Date.now(), ...(error ? { error } : {}) });
    job.counts[status]++;
    job.next++;
    job.updatedAt = Date.now();
  }

  private finishIfDone(job: Job) {
    if (job.next >= job.numbers.length && ACTIVE.includes(job.state)) {
      job.state = "completed";
      job.updatedAt = Date.now();
    }
  }

  private async loop() {
    const { batchSize, checkTimeoutMs } = getConfig();
    for (;;) {
      const job = this.pickJob();
      if (!job) return;

      if (!this.engine.isReady()) {
        for (const j of this.jobs.values()) if (ACTIVE.includes(j.state)) j.state = "waiting_connection";
        await sleep(2000);
        continue;
      }
      job.state = "running";
      job.lastServedAt = Date.now();

      // Serve cache hits first without touching WhatsApp.
      while (job.next < job.numbers.length) {
        const hit = this.cache.get(job.numbers[job.next]);
        if (!hit) break;
        this.record(job, job.numbers[job.next], hit.exists ? "available" : "not_available");
      }
      this.finishIfDone(job);
      if (job.state !== "running") continue;

      const batch = job.numbers.slice(job.next, job.next + batchSize);
      try {
        const map = await this.gate.run(() => {
          if (!this.engine.isReady()) throw new EngineUnavailableError();
          return withTimeout(this.engine.check(batch), checkTimeoutMs);
        });
        // The job may have been stopped while waiting; results are still valid, so keep them.
        job.attempts = 0;
        for (const n of batch) {
          const exists = map.get(n) ?? false;
          this.cache.set(n, exists);
          this.record(job, n, exists ? "available" : "not_available");
        }
      } catch (err) {
        if (err instanceof EngineUnavailableError || !this.engine.isReady()) {
          // Disconnected mid-batch: retry the same batch once the session is back.
          continue;
        }
        job.attempts++;
        logger.warn({ err: (err as Error).message, attempt: job.attempts }, "batch lookup failed");
        if (job.attempts < MAX_BATCH_ATTEMPTS) {
          await sleep(2000 * job.attempts);
          continue;
        }
        job.attempts = 0;
        const message = err instanceof TimeoutError ? "Timed out" : "Lookup failed";
        for (const n of batch) this.record(job, n, "error", message);
      }
      this.finishIfDone(job);
    }
  }

  private cleanup() {
    const now = Date.now();
    for (const job of this.jobs.values()) {
      const finished = job.state === "completed" || job.state === "stopped";
      if (finished && now - job.updatedAt > FINISHED_TTL_MS) this.jobs.delete(job.id);
      else if (!finished && now - job.lastPolledAt > ABANDONED_AFTER_MS) {
        job.state = "stopped";
        job.updatedAt = now;
      }
    }
  }
}

export function getCheckQueue(): CheckQueue {
  return singleton("check-queue", () => new CheckQueue(new BaileysCheckEngine(getWhatsAppSession())));
}

export { EngineUnavailableError };
