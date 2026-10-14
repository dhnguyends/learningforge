import { NextResponse } from "next/server";

/**
 * Self-registration is disabled: accounts are created by an administrator at
 * /admin (POST /api/admin/users). Kept as an explicit 403 so old clients get
 * a clear answer instead of a 404.
 */
export async function POST() {
  return NextResponse.json(
    { error: "Account creation is disabled. Ask an administrator for an account.", code: "registration_disabled" },
    { status: 403 },
  );
}
