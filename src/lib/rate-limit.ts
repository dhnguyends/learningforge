import { getEnv } from "@/lib/env";

/**
 * Sliding-window rate limiter for expensive endpoints.
 * In-memory by default (fine for a single web dyno); swap in a Redis ZSET
 * backend via RATE_LIMIT_REDIS_URL when running multiple instances.
 */
const buckets = new Map<string, number[]>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

export function rateLimit(key: string, limitPerWindow?: number, windowMs = 3_600_000): RateLimitResult {
  const limit = limitPerWindow ?? getEnv().GENERATION_RATE_LIMIT_PER_HOUR;
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);

  if (hits.length >= limit) {
    const oldest = hits[0];
    return { allowed: false, remaining: 0, retryAfterSec: Math.ceil((windowMs - (now - oldest)) / 1000) };
  }

  hits.push(now);
  buckets.set(key, hits);
  // Prevent unbounded growth of idle keys.
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) if (v.every((t) => now - t >= windowMs)) buckets.delete(k);
  }
  return { allowed: true, remaining: limit - hits.length, retryAfterSec: 0 };
}

/** Forget a key's hits (e.g. after a successful sign-in). */
export function resetRateLimit(key: string): void {
  buckets.delete(key);
}

/**
 * Best-effort client IP for throttling. Behind a proxy the first
 * X-Forwarded-For hop is the client; it is spoofable, so IP limits are a
 * secondary guard and per-account limits the primary one.
 */
export function clientIp(headers: Headers | Record<string, string | string[] | undefined> | undefined): string {
  const get = (name: string): string | undefined => {
    if (!headers) return undefined;
    if (headers instanceof Headers) return headers.get(name) ?? undefined;
    const v = headers[name] ?? headers[name.toLowerCase()];
    return Array.isArray(v) ? v[0] : v;
  };
  return get("x-forwarded-for")?.split(",")[0]?.trim() || get("x-real-ip")?.trim() || "unknown";
}
