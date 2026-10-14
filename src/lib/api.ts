import { NextRequest, NextResponse } from "next/server";
import { ZodError, type ZodTypeAny, type output } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import type { Session } from "next-auth";

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, message: string, code = "error") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const unauthorized = () => new ApiError(401, "Authentication required", "unauthorized");
export const forbidden = () => new ApiError(403, "You do not have access to this resource", "forbidden");
export const notFound = (what = "Resource") => new ApiError(404, `${what} not found`, "not_found");
export const badRequest = (msg: string) => new ApiError(400, msg, "bad_request");
export const rateLimited = (retryAfterSec: number) =>
  new ApiError(429, `Rate limit exceeded. Retry in ${retryAfterSec}s.`, "rate_limited");

type Handler<Ctx> = (req: NextRequest, ctx: Ctx) => Promise<NextResponse | Response>;

/** Wraps a route handler with uniform error responses. */
export function apiHandler<Ctx = unknown>(fn: Handler<Ctx>): Handler<Ctx> {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      if (err instanceof ApiError) {
        const res = NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
        if (err.status === 429) res.headers.set("Retry-After", "60");
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
