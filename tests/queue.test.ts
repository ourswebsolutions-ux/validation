/**
 * Exercises the server job queue with a stub engine (test-only) so batching, retries,
 * error isolation, pause/stop and disconnect handling can be verified without a phone.
 * Run with the react-server condition so "server-only" imports resolve (see package.json).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.CHECK_INTERVAL_MS = "1000";
process.env.CHECK_BATCH_SIZE = "3";
process.env.CHECK_CACHE_TTL_MS = "0";
process.env.LOG_LEVEL = "silent";

const { CheckQueue } = await import("../server/whatsapp/queue");
type Engine = ConstructorParameters<typeof CheckQueue>[0];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn: () => boolean, timeoutMs = 15_000) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
    await sleep(50);
  }
}

function stubEngine(opts: { ready?: () => boolean; fail?: (batch: string[], call: number) => boolean } = {}) {
  const calls: string[][] = [];
  const engine: Engine = {
    isReady: opts.ready ?? (() => true),
    async check(numbers) {
      calls.push(numbers);
      if (opts.fail?.(numbers, calls.length)) throw new Error("boom");
      // Deterministic stub: numbers ending in an even digit are "registered".
      return new Map(numbers.map((n) => [n, Number(n.at(-1)) % 2 === 0]));
    },
  };
  return { engine, calls };
}

const NUMS = ["+923001234560", "+923001234561", "+923001234562", "+923001234563", "+923001234564"];

test("processes a job in rate-limited batches and reports results", async () => {
  const { engine, calls } = stubEngine();
  const q = new CheckQueue(engine);
  const job = q.createJob("a", [...NUMS, NUMS[0]]); // duplicate is dropped
  assert.equal(job.numbers.length, 5);
  const t0 = Date.now();
  await waitFor(() => job.state === "completed");
  assert.deepEqual(calls.map((c) => c.length), [3, 2]);
  assert.ok(Date.now() - t0 >= 900, "second batch waited for the rate interval");
  const res = q.toResponse(job, 0);
  assert.deepEqual(res.counts, { available: 3, not_available: 2, error: 0 });
  assert.equal(q.toResponse(job, 3).results.length, 2);
});

test("a failing batch is retried, then marked as error without stopping the queue", async () => {
  const { engine } = stubEngine({ fail: (batch) => batch.includes(NUMS[0]) });
  const q = new CheckQueue(engine);
  const job = q.createJob("b", NUMS);
  await waitFor(() => job.state === "completed", 30_000);
  const res = q.toResponse(job, 0);
  assert.equal(res.counts.error, 3);
  assert.equal(res.counts.available + res.counts.not_available, 2);
  assert.ok(res.results.filter((r) => r.status === "error").every((r) => r.error === "Lookup failed"));
});

test("waits while disconnected and resumes when the session is back", async () => {
  let ready = false;
  const { engine } = stubEngine({ ready: () => ready });
  const q = new CheckQueue(engine);
  const job = q.createJob("c", NUMS.slice(0, 2));
  await waitFor(() => job.state === "waiting_connection");
  assert.equal(job.results.length, 0);
  ready = true;
  await waitFor(() => job.state === "completed");
  assert.equal(job.results.length, 2);
});

test("pause, resume and stop", async () => {
  const { engine } = stubEngine();
  const q = new CheckQueue(engine);
  const many = Array.from({ length: 15 }, (_, i) => `+9230012345${String(i).padStart(2, "0")}`);
  const job = q.createJob("d", many);
  q.applyAction(job, "pause");
  await sleep(1500);
  const pausedCount = job.results.length;
  await sleep(1200);
  assert.equal(job.results.length, pausedCount, "no progress while paused");
  q.applyAction(job, "resume");
  await waitFor(() => job.results.length > pausedCount);
  q.applyAction(job, "stop");
  assert.equal(job.state, "stopped");
  await sleep(1500);
  const stoppedCount = job.results.length;
  await sleep(1500);
  assert.equal(job.results.length, stoppedCount, "no progress after stop");
  assert.ok(stoppedCount < many.length);
});

test("jobs are only visible to their owner and per-client limits apply", () => {
  const { engine } = stubEngine({ ready: () => false });
  const q = new CheckQueue(engine);
  const j = q.createJob("owner", NUMS);
  assert.equal(q.getJob(j.id, "someone-else"), null);
  assert.ok(q.getJob(j.id, "owner"));
  q.createJob("owner", NUMS);
  assert.throws(() => q.createJob("owner", NUMS), /in progress/);
});
