import { z } from "zod";
import { prisma, jsonSafe } from "@/lib/db";
import { apiHandler, ok, parseJsonBody, requireAdmin, badRequest, notFound } from "@/lib/api";
import { hashPassword } from "@/lib/auth";
import { getStorage } from "@/lib/storage";
import { audit } from "@/lib/audit";
import { ADMIN_USER_SELECT } from "@/lib/admin";

type Ctx = { params: { userId: string } };

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    email: z.string().trim().email().max(320).optional(),
    password: z.string().min(10, "Password must be at least 10 characters").max(256).optional(),
    role: z.enum(["USER", "ADMIN"]).optional(),
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
  const existing = await prisma.user.findUnique({ where: { id: params.userId }, select: { id: true, role: true } });
  if (!existing) throw notFound("User");

  if (body.role === "USER" && existing.role === "ADMIN") await assertNotLastAdmin(existing.id);
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

  // Purge stored files of the workspaces this user OWNS (not shared ones they
  // merely belong to), then cascade the rows.
  const owned = await prisma.workspace.findMany({ where: { ownerId: existing.id }, select: { id: true } });
  const storage = getStorage();
  for (const w of owned) {
    await storage.deletePrefix(`workspaces/${w.id}`).catch((err) => console.error("[admin.user_delete] storage purge failed", err));
  }
  await prisma.user.delete({ where: { id: existing.id } });
  await audit({ userId: admin.user.id, action: "admin.user_delete", entityType: "user", entityId: existing.id });
  return ok({ deleted: true });
});
