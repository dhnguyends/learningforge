import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import "../helpers";
import { prisma, createTestUser, disposeTestUser, type TestUser } from "../helpers";
import { authOptions, SIGN_IN_MAX_PER_ACCOUNT } from "@/lib/auth";
import { POST as register } from "@/app/api/auth/register/route";
import { POST as reset } from "@/app/api/auth/reset/route";

/**
 * REVIEW-REPORT.md S9: sign-in, registration and password-reset requests
 * were unthrottled — unlimited password guessing against any account.
 */

type Authorize = (
  credentials: Record<string, string> | undefined,
  req: { headers: Record<string, string> },
) => Promise<unknown>;

const authorize = (authOptions.providers[0] as unknown as { options: { authorize: Authorize } }).options.authorize;

let user: TestUser;
const PASSWORD = "irrelevant-password"; // set by createTestUser

beforeAll(async () => {
  user = await createTestUser("Throttle");
});

afterAll(async () => {
  await disposeTestUser(user.email);
  await prisma.user.deleteMany({ where: { email: { startsWith: "throttle-reg-" } } });
  await prisma.$disconnect();
});

describe("credentials sign-in", () => {
  it("locks an account after repeated failures, even with the right password", async () => {
    const req = (ip: string) => ({ headers: { "x-forwarded-for": ip } });
    for (let i = 0; i < SIGN_IN_MAX_PER_ACCOUNT; i++) {
      // Rotate IPs so only the per-account limit is in play.
      expect(await authorize({ email: user.email, password: `wrong-${i}` }, req(`10.0.0.${i}`))).toBeNull();
    }
    await expect(authorize({ email: user.email, password: PASSWORD }, req("10.0.1.1"))).rejects.toThrow(/Too many sign-in attempts/);
  });

  it("a successful sign-in clears the account's failure count", async () => {
    const other = await createTestUser("Throttle ok");
    try {
      const req = { headers: { "x-forwarded-for": "10.9.9.9" } };
      for (let i = 0; i < SIGN_IN_MAX_PER_ACCOUNT - 1; i++) await authorize({ email: other.email, password: "nope-nope" }, req);
      expect(await authorize({ email: other.email, password: PASSWORD }, req)).toMatchObject({ id: other.id });
      // Counter reset: another failure is just a failure, not a lockout.
      expect(await authorize({ email: other.email, password: "nope-again" }, req)).toBeNull();
    } finally {
      await disposeTestUser(other.email);
    }
  });
});

describe("registration and reset", () => {
  const post = (url: string, body: unknown, ip: string) =>
    new NextRequest(url, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
    });

  it("limits account creation per client IP with a real Retry-After", async () => {
    const ip = "10.20.30.40";
    const statuses: number[] = [];
    let retryAfter: string | null = null;
    for (let i = 0; i < 6; i++) {
      const res = await register(
        post("http://localhost/api/auth/register", { name: "R", email: `throttle-reg-${crypto.randomUUID()}@test.lectureforge`, password: "long-enough-pw" }, ip),
        {} as never,
      );
      statuses.push(res.status);
      if (res.status === 429) retryAfter = res.headers.get("Retry-After");
    }
    expect(statuses.slice(0, 5).every((s) => s === 201)).toBe(true);
    expect(statuses[5]).toBe(429);
    expect(Number(retryAfter)).toBeGreaterThan(3000); // computed from the 1h window, not a fixed 60
  });

  it("limits password-reset requests per client IP", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await reset(post("http://localhost/api/auth/reset", { email: "someone@test.lectureforge" }, "10.50.60.70"), {} as never);
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(statuses[5]).toBe(429);
  });
});
