import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { effectiveRole } from "@/lib/admin";

/**
 * Server-side guard for /admin, in addition to the middleware: the middleware
 * reads the role from the session token, which can lag a demotion until the
 * next session refresh; this re-checks the database (role ADMIN and Human)
 * before anything renders. Standard accounts land on their dashboard with an
 * "Access denied" message. The admin APIs check again on every request.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/auth/sign-in?callbackUrl=%2Fadmin");
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true, nature: true } });
  if (!user || effectiveRole(user.role, user.nature) !== "ADMIN") redirect("/dashboard?denied=admin");
  return <>{children}</>;
}
