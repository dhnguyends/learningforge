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

export function rateLimit(key: string, limitPerHour?: number): RateLimitResult {
  const limit = limitPerHour ?? getEnv().GENERATION_RATE_LIMIT_PER_HOUR;
  const now = Date.now();
  const windowMs = 3_600_000;
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
