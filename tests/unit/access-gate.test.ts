import { describe, it, expect, afterEach } from "vitest";
import { NextRequest, type NextFetchEvent } from "next/server";
import { ACCESS_COOKIE, safeEqual, signAccessToken, verifyAccessToken, isGateExempt } from "@/lib/access-gate";
import middleware from "@/middleware";

const KEY = "correct-horse-battery";
const SECRET = "test-secret-test-secret-test-secret";

describe("access tokens", () => {
  it("verifies a token signed for the same key and secret", async () => {
    const token = await signAccessToken(KEY, Date.now(), SECRET);
    expect(await verifyAccessToken(token, KEY, Date.now(), SECRET)).toBe(true);
  });

  it("never contains the key itself", async () => {
    expect(await signAccessToken(KEY, Date.now(), SECRET)).not.toContain(KEY);
  });

  it("is invalidated by rotating the key or the secret", async () => {
    const token = await signAccessToken(KEY, Date.now(), SECRET);
    expect(await verifyAccessToken(token, "another-key-123", Date.now(), SECRET)).toBe(false);
    expect(await verifyAccessToken(token, KEY, Date.now(), "another-secret")).toBe(false);
  });

  it("expires", async () => {
    const issued = Date.now();
    const token = await signAccessToken(KEY, issued, SECRET);
    expect(await verifyAccessToken(token, KEY, issued + 31 * 24 * 3600 * 1000, SECRET)).toBe(false);
  });

  it("rejects tampered and malformed tokens", async () => {
    const token = await signAccessToken(KEY, Date.now(), SECRET);
    const [exp, sig] = token.split(".");
    expect(await verifyAccessToken(`${Number(exp) + 999999}.${sig}`, KEY, Date.now(), SECRET)).toBe(false);
    for (const bad of ["", "abc", "1.2.3", `${exp}.`, undefined, null]) {
      expect(await verifyAccessToken(bad as string, KEY, Date.now(), SECRET)).toBe(false);
    }
  });

  it("safeEqual compares exactly", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });

  it("only exempts the unlock page, its API and static assets", () => {
    expect(isGateExempt("/access")).toBe(true);
    expect(isGateExempt("/api/access")).toBe(true);
    expect(isGateExempt("/_next/static/chunk.js")).toBe(true);
    for (const p of ["/", "/auth/sign-in", "/api/auth/csrf", "/api/study-sets", "/api/files/x", "/admin", "/accessx"]) {
      expect(isGateExempt(p)).toBe(false);
    }
  });
});

describe("middleware gate", () => {
  const event = {} as NextFetchEvent;
  const prev = { key: process.env.LECTURE_ACCESS_KEY, secret: process.env.NEXTAUTH_SECRET };
  afterEach(() => {
    process.env.LECTURE_ACCESS_KEY = prev.key;
    process.env.NEXTAUTH_SECRET = prev.secret;
  });

  it("is off when LECTURE_ACCESS_KEY is unset", async () => {
    delete process.env.LECTURE_ACCESS_KEY;
    const res = await middleware(new NextRequest("http://localhost/"), event);
    expect(res.status).toBe(200);
  });

  it("redirects pages and rejects APIs without the cookie", async () => {
    process.env.LECTURE_ACCESS_KEY = KEY;
    const page = await middleware(new NextRequest("http://localhost/auth/sign-in?x=1"), event);
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toBe("http://localhost/access?next=%2Fauth%2Fsign-in%3Fx%3D1");

    const api = await middleware(new NextRequest("http://localhost/api/study-sets"), event);
    expect(api.status).toBe(401);
    expect(await api.json()).toMatchObject({ code: "access_required" });

    const unlock = await middleware(new NextRequest("http://localhost/access"), event);
    expect(unlock.status).toBe(200);
  });

  it("lets a valid cookie through and rejects a forged one", async () => {
    process.env.LECTURE_ACCESS_KEY = KEY;
    process.env.NEXTAUTH_SECRET = SECRET;
    const good = await signAccessToken(KEY, Date.now(), SECRET);
    const ok = await middleware(new NextRequest("http://localhost/", { headers: { cookie: `${ACCESS_COOKIE}=${good}` } }), event);
    expect(ok.status).toBe(200);
    const forged = await middleware(new NextRequest("http://localhost/", { headers: { cookie: `${ACCESS_COOKIE}=9999999999.forged` } }), event);
    expect(forged.status).toBe(307);
  });
});
