import { NextRequest, NextResponse } from "next/server";
import { ZodError, type ZodTypeAny, type output } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import type { Session } from "next-auth";
import { prisma } from "@/lib/db";
import { getEnv, type Env } from "@/lib/env";
import { effectiveRole } from "@/lib/admin";

export class ApiError extends Error {
  status: number;
  code: string;
  retryAfterSec?: number;

  constructor(status: number, message: string, code = "error", retryAfterSec?: number) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfterSec = retryAfterSec;
  }
}

export const unauthorized = () => new ApiError(401, "Authentication required", "unauthorized");
export const forbidden = () => new ApiError(403, "You do not have access to this resource", "forbidden");
export const notFound = (what = "Resource") => new ApiError(404, `${what} not found`, "not_found");
export const badRequest = (msg: string) => new ApiError(400, msg, "bad_request");
export const rateLimited = (retryAfterSec: number) =>
  new ApiError(429, `Rate limit exceeded. Retry in ${retryAfterSec}s.`, "rate_limited", retryAfterSec);

type Handler<Ctx> = (req: NextRequest, ctx: Ctx) => Promise<NextResponse | Response>;

/** Wraps a route handler with uniform error responses. */
export function apiHandler<Ctx = unknown>(fn: Handler<Ctx>): Handler<Ctx> {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      if (err instanceof ApiError) {
        const res = NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
        if (err.status === 429) res.headers.set("Retry-After", String(err.retryAfterSec ?? 60));
        return res;
      }
      if (err instanceof ZodError) {
        return NextResponse.json(
          { error: "Invalid request body", code: "validation_error", issues: err.issues },
          { status: 400 },
        );
      }
      console.error("[api] unhandled error:", err);
      return NextResponse.json({ error: "Internal server error", code: "internal" }, { status: 500 });
    }
  };
}

/** Requires a signed-in user; returns the session. */
export async function requireSession(): Promise<Session> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) throw unauthorized();
  // Sessions are stateless JWTs: without this check an account deleted by an
  // administrator could keep using the API until its token expired.
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true, nature: true, lastActiveAt: true } });
  if (!user) throw unauthorized();
  // Current database role (not the JWT's), and never ADMIN for a Bot account.
  session.user.role = effectiveRole(user.role, user.nature);
  await touchLastActive(session.user.id, user.lastActiveAt);
  return session;
}

/** "Last used" (admin Users tab) is refreshed at most this often, not on every request. */
const LAST_ACTIVE_RESOLUTION_MS = 5 * 60_000;

async function touchLastActive(userId: string, lastActiveAt: Date | null): Promise<void> {
  if (lastActiveAt && Date.now() - lastActiveAt.getTime() < LAST_ACTIVE_RESOLUTION_MS) return;
  await prisma.user.update({ where: { id: userId }, data: { lastActiveAt: new Date() } }).catch(() => undefined);
}

/** Requires a signed-in ADMIN (Human), checked against the database (not the JWT). */
export async function requireAdmin(): Promise<Session> {
  const session = await requireSession();
  if (session.user.role !== "ADMIN") throw forbidden();
  return session;
}

/** Parses and validates a JSON body against a Zod schema (result type = schema output). */
export async function parseJsonBody<S extends ZodTypeAny>(req: NextRequest, schema: S): Promise<output<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw badRequest("Request body must be valid JSON");
  }
  return schema.parse(raw) as output<S>;
}

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, init);
}

/**
 * Origin the BROWSER used to reach us, for URLs we hand back to it (local
 * upload tickets, playback links).
 *
 * Not `new URL(req.url).origin`: under `next start` Next builds req.url from
 * the server's own bind address (e.g. http://localhost:3000), not from the
 * Host header — behind a port mapping (packet.ai NodePort :20002 → :3000) the
 * browser was told to PUT uploads to a port it cannot reach, and uploads hung.
 *
 * Production: APP_URL is authoritative (operator-set; a forged Host header
 * cannot redirect uploads elsewhere). Development: the Host header, so the
 * dev server works on whatever port it runs on.
 */
export function publicOrigin(req: Request, env: Pick<Env, "NODE_ENV" | "APP_URL"> = getEnv()): string {
  if (env.NODE_ENV === "production" && env.APP_URL) return env.APP_URL.replace(/\/+$/, "");
  const host = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || req.headers.get("host");
  if (!host) return new URL(req.url).origin;
  const forwardedProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const proto = forwardedProto === "https" || forwardedProto === "http" ? forwardedProto : new URL(req.url).protocol.replace(":", "");
  return `${proto}://${host}`;
}
