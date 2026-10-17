import { z } from "zod";
import { prisma, jsonSafe } from "@/lib/db";
import { apiHandler, ok, parseJsonBody, requireAdmin, badRequest, notFound } from "@/lib/api";
import { hashPassword } from "@/lib/auth";
import { deleteAccountCompletely } from "@/lib/deletion";
import { audit } from "@/lib/audit";
import { ADMIN_USER_SELECT, adminRuleViolation } from "@/lib/admin";

type Ctx = { params: { userId: string } };

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    email: z.string().trim().email().max(320).optional(),
    password: z.string().min(10, "Password must be at least 10 characters").max(256).optional(),
    role: z.enum(["USER", "TEACHER", "ADMIN"]).optional(),
    nature: z.enum(["HUMAN", "BOT"]).optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), { message: "Nothing to update" });

/** At least one administrator must remain, or nobody could manage accounts. */
async function assertNotLastAdmin(userId: string): Promise<void> {
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (target?.role !== "ADMIN") return;
  const admins = await prisma.user.count({ where: { role: "ADMIN" } });
  if (admins <= 1) throw badRequest("This is the last administrator account — promote another account first.");
}

export const PATCH = apiHandler<Ctx>(async (req, { params }) => {
  const admin = await requireAdmin();
  const body = await parseJsonBody(req, patchSchema);
  const existing = await prisma.user.findUnique({ where: { id: params.userId }, select: { id: true, role: true, nature: true } });
  if (!existing) throw notFound("User");
  // Promotion rule: only Human accounts can be Admin (a Bot is made Human first).
  const violation = adminRuleViolation(
    { role: body.role ?? existing.role, nature: body.nature ?? existing.nature },
    { role: existing.role, nature: existing.nature },
  );
  if (violation) throw badRequest(violation);

  if (body.role && body.role !== "ADMIN" && existing.role === "ADMIN") await assertNotLastAdmin(existing.id);
  const email = body.email?.toLowerCase();
  if (email) {
    const clash = await prisma.user.findFirst({ where: { email, NOT: { id: existing.id } }, select: { id: true } });
    if (clash) throw badRequest("Another account already uses this email");
  }

  const user = await prisma.user.update({
    where: { id: existing.id },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(email ? { email } : {}),
      ...(body.role ? { role: body.role } : {}),
      ...(body.nature ? { nature: body.nature } : {}),
      ...(body.password ? { passwordHash: await hashPassword(body.password) } : {}),
    },
    select: ADMIN_USER_SELECT,
  });
  await audit({
    userId: admin.user.id,
    action: "admin.user_update",
    entityType: "user",
    entityId: user.id,
    // Never log the password itself — only that it changed.
    metadata: { fields: Object.keys(body).filter((k) => body[k as keyof typeof body] !== undefined) },
  });
  return ok(jsonSafe({ user }));
});

export const DELETE = apiHandler<Ctx>(async (_req, { params }) => {
  const admin = await requireAdmin();
  if (params.userId === admin.user.id) throw badRequest("You cannot delete your own account here — ask another administrator.");
  const existing = await prisma.user.findUnique({ where: { id: params.userId }, select: { id: true, email: true } });
  if (!existing) throw notFound("User");
  await assertNotLastAdmin(existing.id);

  // The account, every study set it owns (with all sources) and their files.
  const removed = await deleteAccountCompletely(existing.id);
  await audit({ userId: admin.user.id, action: "admin.user_delete", entityType: "user", entityId: existing.id, metadata: { ...removed } });
  return ok({ deleted: true, ...removed });
});
