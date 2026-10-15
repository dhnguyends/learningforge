import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { encode } from "next-auth/jwt";
import { ACCESS_COOKIE, DEV_SECRET, safeEqual, signAccessToken, verifyAccessToken, isGateExempt } from "@/lib/access-gate";
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
  const prev = { key: process.env.LECTURE_ACCESS_KEY, secret: process.env.NEXTAUTH_SECRET };
  afterEach(() => {
    process.env.LECTURE_ACCESS_KEY = prev.key;
    process.env.NEXTAUTH_SECRET = prev.secret;
  });

  it("is off when LECTURE_ACCESS_KEY is unset", async () => {
    delete process.env.LECTURE_ACCESS_KEY;
    const res = await middleware(new NextRequest("http://localhost/"));
    expect(res.status).toBe(200);
  });

  it("redirects pages and rejects APIs without the cookie", async () => {
    process.env.LECTURE_ACCESS_KEY = KEY;
    const page = await middleware(new NextRequest("http://localhost/auth/sign-in?x=1"));
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toBe("http://localhost/access?next=%2Fauth%2Fsign-in%3Fx%3D1");

    const api = await middleware(new NextRequest("http://localhost/api/study-sets"));
    expect(api.status).toBe(401);
    expect(await api.json()).toMatchObject({ code: "access_required" });

    const unlock = await middleware(new NextRequest("http://localhost/access"));
    expect(unlock.status).toBe(200);
  });

  it("redirects to the public origin behind a TLS proxy, not the app's internal address", async () => {
    process.env.LECTURE_ACCESS_KEY = KEY;
    const env = process.env as Record<string, string | undefined>;
    const prevNodeEnv = env.NODE_ENV;
    const prevAppUrl = env.APP_URL;
    env.NODE_ENV = "production";
    env.APP_URL = "https://203.0.113.10:20002";
    try {
      // What Next sees behind Caddy: its own bind address in the URL.
      const res = await middleware(new NextRequest("https://localhost:3001/dashboard"));
      expect(res.headers.get("location")).toBe("https://203.0.113.10:20002/access?next=%2Fdashboard");
    } finally {
      env.NODE_ENV = prevNodeEnv;
      env.APP_URL = prevAppUrl;
    }
  });

  it("lets a valid cookie through and rejects a forged one", async () => {
    process.env.LECTURE_ACCESS_KEY = KEY;
    process.env.NEXTAUTH_SECRET = SECRET;
    const good = await signAccessToken(KEY, Date.now(), SECRET);
    const ok = await middleware(new NextRequest("http://localhost/", { headers: { cookie: `${ACCESS_COOKIE}=${good}` } }));
    expect(ok.status).toBe(200);
    const forged = await middleware(new NextRequest("http://localhost/", { headers: { cookie: `${ACCESS_COOKIE}=9999999999.forged` } }));
    expect(forged.status).toBe(307);
  });
});

describe("middleware sign-in guard", () => {
  const env = process.env as Record<string, string | undefined>;
  const saved = { ...env };
  afterEach(() => {
    for (const k of ["LECTURE_ACCESS_KEY", "NEXTAUTH_SECRET", "NEXTAUTH_URL", "APP_URL", "NODE_ENV"]) env[k] = saved[k];
  });

  const session = (role?: "USER" | "ADMIN") =>
    encode({ token: { sub: "u1", ...(role ? { role } : {}) }, secret: DEV_SECRET });

  it("sends signed-out visitors to the PUBLIC sign-in URL behind a TLS proxy", async () => {
    delete env.LECTURE_ACCESS_KEY;
    delete env.NEXTAUTH_SECRET;
    env.NODE_ENV = "production";
    env.APP_URL = "https://203.0.113.10:20002";
    const res = await middleware(new NextRequest("https://localhost:3001/dashboard?tab=1"));
    expect(res.headers.get("location")).toBe("https://203.0.113.10:20002/auth/sign-in?callbackUrl=%2Fdashboard%3Ftab%3D1");
  });

  it("lets a signed-in user in, but keeps non-admins out of /admin", async () => {
    delete env.LECTURE_ACCESS_KEY;
    delete env.NEXTAUTH_SECRET;
    const cookie = (jwt: string) => ({ headers: { cookie: `next-auth.session-token=${jwt}` } });
    const user = await session("USER");
    expect((await middleware(new NextRequest("http://localhost/dashboard", cookie(user)))).status).toBe(200);
    expect((await middleware(new NextRequest("http://localhost/admin", cookie(user)))).status).toBe(307);
    const admin = await session("ADMIN");
    expect((await middleware(new NextRequest("http://localhost/admin", cookie(admin)))).status).toBe(200);
  });
});

