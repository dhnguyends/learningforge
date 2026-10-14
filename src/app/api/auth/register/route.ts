import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiHandler, ok, parseJsonBody, badRequest } from "@/lib/api";
import { hashPassword, ensureUserWorkspace } from "@/lib/auth";
import { audit } from "@/lib/audit";

const registerSchema = z.object({
  name: z.string().min(1).max(80),
  email: z.string().email(),
  password: z.string().min(10, "Password must be at least 10 characters"),
});

export const POST = apiHandler(async (req) => {
  const body = await parseJsonBody(req, registerSchema);
  const email = body.email.toLowerCase();

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw badRequest("An account with this email already exists");

  const user = await prisma.user.create({
    data: { name: body.name, email, passwordHash: await hashPassword(body.password) },
    select: { id: true, email: true, name: true },
  });
  await ensureUserWorkspace(user.id, user.name);
  await audit({ userId: user.id, action: "account.register", entityType: "user", entityId: user.id });

  return ok({ user }, { status: 201 });
});
