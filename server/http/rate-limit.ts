import "server-only";
import { singleton } from "../singleton";

/** Fixed-window in-memory rate limiter keyed by bucket + client. */
class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();

  constructor() {
    const timer = setInterval(() => {
      const now = Date.now();
      for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
    }, 60_000);
    timer.unref?.();
  }

  consume(key: string, limit: number, windowMs = 60_000): { ok: boolean; retryAfterSec: number } {
    const now = Date.now();
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + windowMs });
      return { ok: true, retryAfterSec: 0 };
    }
    entry.count++;
    if (entry.count > limit) return { ok: false, retryAfterSec: Math.ceil((entry.resetAt - now) / 1000) };
    return { ok: true, retryAfterSec: 0 };
  }
}

export const rateLimiter = singleton("rate-limiter", () => new RateLimiter());
