#!/usr/bin/env node
/**
 * Load check for PolyLingue: signs in as one (test) account and sends
 * read-only requests from many virtual learners at once, then prints the
 * latency (p50, p95, p99, max) and errors per endpoint. Nothing is written.
 *
 *   npm run load:check
 *   BASE_URL=https://203.0.113.10:31234 LOAD_EMAIL=… LOAD_PASSWORD=… CONCURRENCY=25 DURATION=60 npm run load:check
 *
 * Environment: BASE_URL (default https://localhost:3001), LOAD_EMAIL /
 * LOAD_PASSWORD (default the seeded demo account), LECTURE_ACCESS_KEY (if the
 * site has the access gate; read from .env when present), CONCURRENCY (10),
 * DURATION seconds (20), P95_LIMIT_MS (1500). A self-signed or private-CA
 * certificate is accepted for localhost, or anywhere with ALLOW_SELF_SIGNED=1.
 * Exit code 1 when more than 1 % of requests fail or a p95 is over the limit.
 */
import { readFileSync, existsSync } from "node:fs";

const BASE = (process.env.BASE_URL ?? "https://localhost:3001").replace(/\/$/, "");
const EMAIL = process.env.LOAD_EMAIL ?? "demo@learningforge.app";
const PASSWORD = process.env.LOAD_PASSWORD ?? "demo-password";
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 10);
const DURATION = Number(process.env.DURATION ?? 20) * 1000;
const P95_LIMIT = Number(process.env.P95_LIMIT_MS ?? 1500);

const host = new URL(BASE).hostname;
if (BASE.startsWith("https://") && (["localhost", "127.0.0.1", "::1"].includes(host) || process.env.ALLOW_SELF_SIGNED === "1")) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // local mkcert / Caddy internal CA
}

function accessKey() {
  if (process.env.LECTURE_ACCESS_KEY) return process.env.LECTURE_ACCESS_KEY;
  if (!existsSync(".env")) return null;
  const m = /^LECTURE_ACCESS_KEY=(.*)$/m.exec(readFileSync(".env", "utf8"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
}

// A tiny cookie jar: one session shared by every virtual learner.
const jar = new Map();
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
function keep(res) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
}
async function call(path, init = {}) {
  const res = await fetch(BASE + path, { ...init, redirect: "manual", headers: { ...(init.headers ?? {}), cookie: cookieHeader() } });
  keep(res);
  return res;
}

async function signIn() {
  const key = accessKey();
  if (key) await call("/api/access", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key }) });
  const { csrfToken } = await (await call("/api/auth/csrf")).json();
  const res = await call("/api/auth/callback/credentials", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ email: EMAIL, password: PASSWORD, csrfToken, json: "true" }),
  });
  if (res.status !== 200 && res.status !== 302) throw new Error(`sign-in failed (${res.status})`);
  const session = await (await call("/api/auth/session")).json();
  if (!session?.user) throw new Error("sign-in failed: no session (check LOAD_EMAIL / LOAD_PASSWORD)");
}

async function endpoints() {
  const list = ["/api/polylingue/courses", "/api/polylingue/notifications", "/api/polylingue/achievements", "/api/polylingue/leagues", "/api/polylingue/summary", "/api/polylingue/classes", "/api/polylingue/assignments"];
  const { courses } = await (await call("/api/polylingue/courses")).json();
  const course = courses?.[0];
  if (course) {
    list.push(`/api/polylingue/courses/${course.id}`, `/api/polylingue/courses/${course.id}/progress`);
    if (course.nextLesson?.id) list.push(`/api/polylingue/courses/${course.id}/lessons/${course.nextLesson.id}`);
    const word = (await (await call(`/api/polylingue/courses/${course.id}/review`)).json().catch(() => ({})))?.cards?.[0]?.term;
    if (word) list.push(`/api/polylingue/speech?lang=${course.targetLang}&text=${encodeURIComponent(word)}`);
  }
  return list;
}

const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0);

async function main() {
  console.log(`Load check on ${BASE} as ${EMAIL}: ${CONCURRENCY} learners for ${DURATION / 1000} s`);
  await signIn();
  const paths = await endpoints();
  const stats = new Map(paths.map((p) => [p, { times: [], errors: 0 }]));
  const end = Date.now() + DURATION;
  let i = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (Date.now() < end) {
        const path = paths[i++ % paths.length];
        const t = performance.now();
        try {
          const res = await call(path);
          await res.arrayBuffer();
          if (res.status >= 400) stats.get(path).errors++;
        } catch {
          stats.get(path).errors++;
        }
        stats.get(path).times.push(performance.now() - t);
      }
    }),
  );

  let total = 0;
  let failed = 0;
  let slow = false;
  console.log("\nendpoint".padEnd(64) + "reqs   err   p50    p95    p99    max (ms)");
  for (const [path, s] of stats) {
    const sorted = s.times.sort((a, b) => a - b);
    total += sorted.length;
    failed += s.errors;
    const p95 = pct(sorted, 95);
    if (p95 > P95_LIMIT) slow = true;
    const f = (n) => String(Math.round(n)).padStart(6);
    console.log(`${path.replace(/text=[^&]+/, "text=…").slice(0, 62).padEnd(62)} ${String(sorted.length).padStart(5)} ${String(s.errors).padStart(5)}${f(pct(sorted, 50))} ${f(p95)} ${f(pct(sorted, 99))} ${f(sorted.at(-1) ?? 0)}${p95 > P95_LIMIT ? "  ← slow" : ""}`);
  }
  const rate = total ? failed / total : 0;
  console.log(`\n${total} requests, ${(total / (DURATION / 1000)).toFixed(1)}/s, ${(rate * 100).toFixed(2)} % errors`);
  if (rate > 0.01 || slow) {
    console.log(`FAILED: ${rate > 0.01 ? "more than 1 % errors" : ""}${rate > 0.01 && slow ? " and " : ""}${slow ? `a p95 over ${P95_LIMIT} ms` : ""}`);
    process.exitCode = 1;
  } else console.log("OK");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
