/**
 * Site-wide access gate (LECTURE_ACCESS_KEY).
 *
 * When LECTURE_ACCESS_KEY is set, every page and API route requires a valid
 * access cookie, obtained once by entering the key at /access. The cookie is
 * an expiring HMAC token — it never contains the key — signed with
 * NEXTAUTH_SECRET over the key itself, so rotating LECTURE_ACCESS_KEY (or the
 * secret) invalidates every issued cookie. Unset = gate disabled (local
 * development, tests).
 *
 * Runs in middleware (edge runtime): Web Crypto only, no Node APIs, and env
 * is read from process.env directly (not getEnv(), which is Node-side).
 */

export const ACCESS_COOKIE = "lf_access";
export const ACCESS_TTL_SEC = 30 * 24 * 3600;
const DEV_SECRET = "lectureforge-development-secret"; // same fallback as src/lib/env.ts

export function accessKey(): string | null {
  const key = process.env.LECTURE_ACCESS_KEY?.trim();
  return key ? key : null;
}

function signingSecret(): string {
  return process.env.NEXTAUTH_SECRET || DEV_SECRET;
}

function base64url(bytes: ArrayBuffer): string {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64url(await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message)));
}

/** Constant-time string comparison (no early exit on the first difference). */
export function safeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export async function signAccessToken(key: string, now = Date.now(), secret = signingSecret()): Promise<string> {
  const exp = Math.floor(now / 1000) + ACCESS_TTL_SEC;
  return `${exp}.${await hmac(secret, `access:${exp}:${key}`)}`;
}

export async function verifyAccessToken(
  token: string | undefined | null,
  key: string,
  now = Date.now(),
  secret = signingSecret(),
): Promise<boolean> {
  if (!token) return false;
  const [expStr, sig, extra] = token.split(".");
  if (!expStr || !sig || extra !== undefined || !/^\d+$/.test(expStr)) return false;
  if (Number(expStr) * 1000 < now) return false;
  return safeEqual(sig, await hmac(secret, `access:${expStr}:${key}`));
}

/**
 * Origin the browser used, for redirects issued by the middleware. Behind a
 * TLS proxy req.nextUrl carries the app's internal address
 * (https://localhost:3001), so production uses APP_URL; elsewhere the
 * forwarded / Host headers. Edge-safe (no getEnv).
 */
export function browserOrigin(req: { headers: Headers; nextUrl: URL }): string {
  const appUrl = process.env.APP_URL?.trim();
  if (process.env.NODE_ENV === "production" && appUrl) return appUrl.replace(/\/+$/, "");
  const host = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (!host) return req.nextUrl.origin;
  return `${proto === "https" || proto === "http" ? proto : req.nextUrl.protocol.replace(":", "")}://${host}`;
}

/** Paths reachable without the access cookie. */
export function isGateExempt(pathname: string): boolean {
  return (
    pathname === "/access" ||
    pathname === "/api/access" ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt"
  );
}
