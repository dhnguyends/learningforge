import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { rateLimit } from "@/lib/rate-limit";

describe("rateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows up to the limit and then blocks with a retry hint", () => {
    const key = `test:${crypto.randomUUID()}`;
    for (let i = 0; i < 3; i++) {
      const r = rateLimit(key, 3);
      expect(r.allowed).toBe(true);
      expect(r.remaining).toBe(3 - i - 1);
    }
    const blocked = rateLimit(key, 3);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect(blocked.retryAfterSec).toBeLessThanOrEqual(3600);
  });

  it("tracks keys independently", () => {
    const a = `test:${crypto.randomUUID()}`;
    const b = `test:${crypto.randomUUID()}`;
    rateLimit(a, 1);
    expect(rateLimit(a, 1).allowed).toBe(false);
    expect(rateLimit(b, 1).allowed).toBe(true);
  });

  it("frees the window after an hour passes", () => {
    const key = `test:${crypto.randomUUID()}`;
    expect(rateLimit(key, 1).allowed).toBe(true);
    expect(rateLimit(key, 1).allowed).toBe(false);

    vi.setSystemTime(new Date("2026-01-15T13:00:01Z"));
    const again = rateLimit(key, 1);
    expect(again.allowed).toBe(true);
    expect(again.remaining).toBe(0);
  });

  it("shrinks retryAfterSec as the oldest hit ages", () => {
    const key = `test:${crypto.randomUUID()}`;
    for (let i = 0; i < 2; i++) rateLimit(key, 2);
    const blockedNow = rateLimit(key, 2);

    vi.setSystemTime(new Date("2026-01-15T12:00:30Z"));
    const blockedLater = rateLimit(key, 2);
    expect(blockedNow.allowed).toBe(false);
    expect(blockedLater.allowed).toBe(false);
    expect(blockedLater.retryAfterSec).toBeLessThan(blockedNow.retryAfterSec);
  });
});
