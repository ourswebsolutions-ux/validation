import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import type { ZodType } from "zod";
import { getConfig } from "../config";
import { rateLimiter } from "./rate-limit";

const MAX_BODY_BYTES = 64 * 1024;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly headers?: Record<string, string>,
  ) {
    super(message);
  }
}

export function json<T>(body: T, init?: ResponseInit) {
  return NextResponse.json(body, { ...init, headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) } });
}

export const CLIENT_COOKIE = "wac_sid";

function clientIp(req: NextRequest): string | null {
  if (!getConfig().trustProxy) return null;
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (fwd) return fwd.slice(0, 64);
  return req.headers.get("x-real-ip")?.trim().slice(0, 64) || null;
}

function browserId(req: NextRequest): string | null {
  const sid = req.cookies.get(CLIENT_COOKIE)?.value;
  return sid && /^[A-Za-z0-9_-]{16,64}$/.test(sid) ? sid : null;
}

/**
 * Key used for rate limiting. Uses the client IP when a trusted proxy provides it; otherwise
 * the anonymous browser cookie, and requests without a cookie share one strict bucket.
 */
export function rateKey(req: NextRequest): string {
  return clientIp(req) ?? browserId(req) ?? "anonymous";
}

/** Owner of bulk jobs: the anonymous browser cookie (set by proxy.ts), else the rate key. */
export function ownerId(req: NextRequest): string {
  return browserId(req) ?? rateKey(req);
}

/**
 * Block cross-site use of the API: browsers send Sec-Fetch-Site / Origin on fetch(),
 * so requests from other websites are rejected. Non-browser clients are subject to
 * rate limits and (optionally) HTTP Basic auth enforced in proxy.ts.
 */
export function assertSameOrigin(req: NextRequest) {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") {
    throw new ApiError(403, "forbidden_origin", "Cross-site requests are not allowed.");
  }
  const origin = req.headers.get("origin");
  if (origin) {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null;
    }
    if (!host || originHost !== host) {
      throw new ApiError(403, "forbidden_origin", "Cross-site requests are not allowed.");
    }
  }
}

export function enforceRateLimit(req: NextRequest, bucket: string, limitPerMin: number) {
  const { ok, retryAfterSec } = rateLimiter.consume(`${bucket}:${rateKey(req)}`, limitPerMin);
  if (!ok) {
    throw new ApiError(429, "rate_limited", `Too many requests. Try again in ${retryAfterSec}s.`, {
      "Retry-After": String(retryAfterSec),
    });
  }
}

export async function readJson<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  const type = req.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) {
    throw new ApiError(415, "unsupported_media_type", "Expected application/json.");
  }
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) throw new ApiError(413, "payload_too_large", "Request body is too large.");
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) throw new ApiError(413, "payload_too_large", "Request body is too large.");
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ApiError(400, "invalid_json", "Malformed JSON body.");
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new ApiError(400, "invalid_input", parsed.error.issues[0]?.message ?? "Invalid input.");
  }
  return parsed.data;
}

/** Wrap a route handler with uniform error handling (never leaks stack traces or paths). */
export function handler<C>(fn: (req: NextRequest, ctx: C) => Promise<Response>) {
  return async (req: NextRequest, ctx: C): Promise<Response> => {
    try {
      assertSameOrigin(req);
      return await fn(req, ctx);
    } catch (err) {
      if (err instanceof ApiError) {
        return json({ error: err.message, code: err.code }, { status: err.status, headers: err.headers });
      }
      const { logger } = await import("../logger");
      logger.error({ err: (err as Error)?.message }, "unhandled API error");
      return json({ error: "Internal server error.", code: "internal_error" }, { status: 500 });
    }
  };
}
