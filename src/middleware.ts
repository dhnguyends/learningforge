import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { ACCESS_COOKIE, DEV_SECRET, accessKey, browserOrigin, isGateExempt, verifyAccessToken } from "@/lib/access-gate";

/** App pages that need a signed-in user (/create was missing before). */
const SIGNED_IN_PAGES = ["/dashboard", "/study-sets", "/settings", "/create", "/admin"];

export default async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const here = encodeURIComponent(pathname + search);

  // 1. Access gate: nothing (pages or APIs) without the LECTURE_ACCESS_KEY cookie.
  const key = accessKey();
  if (key && !isGateExempt(pathname)) {
    const ok = await verifyAccessToken(req.cookies.get(ACCESS_COOKIE)?.value, key);
    if (!ok) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Access key required", code: "access_required" }, { status: 401 });
      }
      // Absolute URL on the browser's origin (not the app's internal one behind a proxy).
      return NextResponse.redirect(`${browserOrigin(req)}/access?next=${here}`);
    }
  }

  // 2. Sign-in (and the ADMIN role for /admin) for app pages. Checked here
  //    rather than with next-auth's withAuth, whose redirect is built from
  //    req.nextUrl — the app's internal address behind the TLS proxy.
  if (SIGNED_IN_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    const token = await getToken({
      req,
      secret: process.env.NEXTAUTH_SECRET || DEV_SECRET,
      // https NEXTAUTH_URL => next-auth issues the __Secure- prefixed session cookie.
      secureCookie: (process.env.NEXTAUTH_URL ?? "").startsWith("https://"),
    });
    const allowed = Boolean(token) && (!pathname.startsWith("/admin") || token?.role === "ADMIN");
    if (!allowed) return NextResponse.redirect(`${browserOrigin(req)}/auth/sign-in?callbackUrl=${here}`);
  }
  return NextResponse.next();
}

export const config = {
  // Everything except Next's static assets (the gate must cover API routes too).
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
