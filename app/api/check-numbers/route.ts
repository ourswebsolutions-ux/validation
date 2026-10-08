import { getConfig } from "@/server/config";
import { ApiError, enforceRateLimit, handler, json, ownerId, readJson } from "@/server/http/api";
import { QueueFullError, getCheckQueue } from "@/server/whatsapp/queue";
import { isE164, normalizePhoneNumber } from "@/lib/phone-number";
import { bulkCheckSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Create a bulk check job. Numbers should already be E.164 (the UI normalizes them);
 * anything that isn't a valid number is rejected up front and reported back as invalid.
 * Results are fetched incrementally from GET /api/check-numbers/:jobId.
 */
export const POST = handler(async (req) => {
  const cfg = getConfig();
  enforceRateLimit(req, "jobs", cfg.rateJobsPerMin);
  const { numbers } = await readJson(req, bulkCheckSchema(cfg.maxNumbersPerRequest));

  const valid: string[] = [];
  const invalid: string[] = [];
  for (const raw of numbers) {
    const n = normalizePhoneNumber(raw);
    if (n.valid && n.e164 && isE164(n.e164)) valid.push(n.e164);
    else invalid.push(raw);
  }
  if (valid.length === 0) throw new ApiError(400, "no_valid_numbers", "None of the submitted numbers are valid.");

  try {
    const queue = getCheckQueue();
    const job = queue.createJob(ownerId(req), valid);
    return json({ ...queue.toResponse(job, 0), invalid }, { status: 202 });
  } catch (err) {
    if (err instanceof QueueFullError) throw new ApiError(429, "queue_full", err.message);
    throw err;
  }
});
