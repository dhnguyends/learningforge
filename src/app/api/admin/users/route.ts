import { z } from "zod";
import { prisma, jsonSafe } from "@/lib/db";
import { apiHandler, ok, parseJsonBody, requireAdmin, badRequest } from "@/lib/api";
import { hashPassword, ensureUserWorkspace } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ADMIN_USER_SELECT, adminRuleViolation } from "@/lib/admin";

/** Account management for administrators (self-registration is disabled). */

export const GET = apiHandler(async () => {
  await requireAdmin();
  const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" }, select: ADMIN_USER_SELECT });
  return ok(jsonSafe({ users }));
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(320),
  password: z.string().min(10, "Password must be at least 10 characters").max(256),
  role: z.enum(["USER", "ADMIN"]).default("USER"),
  // Accounts created by code (tests, AI agents) are bots unless stated otherwise;
  // the "New account" form sends HUMAN explicitly.
  nature: z.enum(["HUMAN", "BOT"]).default("BOT"),
});

export const POST = apiHandler(async (req) => {
  const admin = await requireAdmin();
  const body = await parseJsonBody(req, createSchema);
  const violation = adminRuleViolation({ role: body.role, nature: body.nature });
  if (violation) throw badRequest(violation);
  const email = body.email.toLowerCase();
  if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
    throw badRequest("An account with this email already exists");
  }
  const user = await prisma.user.create({
    data: { name: body.name, email, role: body.role, nature: body.nature, passwordHash: await hashPassword(body.password) },
    select: ADMIN_USER_SELECT,
  });
  await ensureUserWorkspace(user.id, user.name);
  await audit({ userId: admin.user.id, action: "admin.user_create", entityType: "user", entityId: user.id, metadata: { role: user.role, nature: user.nature } });
  return ok(jsonSafe({ user }), { status: 201 });
});
