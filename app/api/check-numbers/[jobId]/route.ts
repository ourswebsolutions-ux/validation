import type { NextRequest } from "next/server";
import { getConfig } from "@/server/config";
import { ApiError, enforceRateLimit, handler, json, ownerId, readJson } from "@/server/http/api";
import { getCheckQueue } from "@/server/whatsapp/queue";
import { cursorSchema, jobActionSchema, jobIdSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ jobId: string }> };

async function loadJob(req: NextRequest, ctx: Ctx) {
  const { jobId } = await ctx.params;
  const id = jobIdSchema.safeParse(jobId);
  if (!id.success) throw new ApiError(400, "invalid_job_id", "Invalid job id.");
  const job = getCheckQueue().getJob(id.data, ownerId(req));
  if (!job) throw new ApiError(404, "job_not_found", "This check job no longer exists.");
  return job;
}

/** Poll job progress. `?cursor=N` returns only results N and later. */
export const GET = handler<Ctx>(async (req, ctx) => {
  enforceRateLimit(req, "read", getConfig().rateReadPerMin);
  const job = await loadJob(req, ctx);
  const cursor = cursorSchema.safeParse(req.nextUrl.searchParams.get("cursor") ?? undefined);
  return json(getCheckQueue().toResponse(job, cursor.success ? cursor.data : 0));
});

/** Pause, resume or stop a job. */
export const POST = handler<Ctx>(async (req, ctx) => {
  enforceRateLimit(req, "jobs", getConfig().rateJobsPerMin * 3);
  const job = await loadJob(req, ctx);
  const { action } = await readJson(req, jobActionSchema);
  const queue = getCheckQueue();
  queue.applyAction(job, action);
  return json(queue.toResponse(job, job.results.length));
});
