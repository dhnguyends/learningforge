import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, parseJsonBody, rateLimited, badRequest } from "@/lib/api";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { ACCESS_COOKIE, ACCESS_TTL_SEC, accessKey, safeEqual, signAccessToken } from "@/lib/access-gate";
import { audit } from "@/lib/audit";

const schema = z.object({ key: z.string().min(1).max(512) });

/** Exchange LECTURE_ACCESS_KEY for the access cookie (see src/lib/access-gate.ts). */
export const POST = apiHandler(async (req: NextRequest) => {
  const key = accessKey();
  if (!key) return NextResponse.json({ ok: true, gate: "disabled" });

  // Guessing the key is the whole attack surface — throttle per client.
  const limit = rateLimit(`access:ip:${clientIp(req.headers)}`, 10, 15 * 60 * 1000);
  if (!limit.allowed) throw rateLimited(limit.retryAfterSec);

  const body = await parseJsonBody(req, schema);
  if (!safeEqual(body.key, key)) {
    await audit({ action: "access.denied", metadata: { ip: clientIp(req.headers) } });
    throw badRequest("Incorrect access key");
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ACCESS_COOKIE, await signAccessToken(key), {
    httpOnly: true,
    sameSite: "lax",
    secure: req.headers.get("x-forwarded-proto") === "https" || req.nextUrl.protocol === "https:",
    path: "/",
    maxAge: ACCESS_TTL_SEC,
  });
  return res;
});
