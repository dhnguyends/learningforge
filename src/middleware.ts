import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { withAuth, type NextRequestWithAuth } from "next-auth/middleware";
import { ACCESS_COOKIE, accessKey, browserOrigin, isGateExempt, verifyAccessToken } from "@/lib/access-gate";

/** App pages that need a signed-in user (/create was missing before). */
const SIGNED_IN_PAGES = ["/dashboard", "/study-sets", "/settings", "/create", "/admin"];

const requireSignIn = withAuth({
  pages: { signIn: "/auth/sign-in" },
  callbacks: {
    // /admin additionally needs the ADMIN role (the admin APIs re-check it in the DB).
    authorized: ({ token, req }) =>
      Boolean(token) && (!req.nextUrl.pathname.startsWith("/admin") || token?.role === "ADMIN"),
  },
});

export default async function middleware(req: NextRequest, event: NextFetchEvent) {
  const { pathname, search } = req.nextUrl;

  // 1. Access gate: nothing (pages or APIs) without the LECTURE_ACCESS_KEY cookie.
  const key = accessKey();
  if (key && !isGateExempt(pathname)) {
    const ok = await verifyAccessToken(req.cookies.get(ACCESS_COOKIE)?.value, key);
    if (!ok) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Access key required", code: "access_required" }, { status: 401 });
      }
      // Absolute URL on the browser's origin (not the app's internal one behind a proxy).
      return NextResponse.redirect(`${browserOrigin(req)}/access?next=${encodeURIComponent(pathname + search)}`);
    }
  }

  // 2. Sign-in (and admin role) for app pages.
  if (SIGNED_IN_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return (requireSignIn as unknown as (r: NextRequestWithAuth, e: NextFetchEvent) => Promise<Response>)(
      req as NextRequestWithAuth,
      event,
    );
  }
  return NextResponse.next();
}

export const config = {
  // Everything except Next's static assets (the gate must cover API routes too).
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
