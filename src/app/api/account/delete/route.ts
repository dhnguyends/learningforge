import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiHandler, ok, parseJsonBody, requireSession, badRequest } from "@/lib/api";
import { getStorage } from "@/lib/storage";
import { audit } from "@/lib/audit";

const deleteSchema = z.object({
  confirm: z.literal("DELETE MY ACCOUNT", {
    errorMap: () => ({ message: "Type DELETE MY ACCOUNT to confirm." }),
  }),
});

/**
 * Account deletion: purges all stored objects for the user's workspaces, then
 * cascades every database row. Irreversible by design.
 */
export const POST = apiHandler(async (req) => {
  const session = await requireSession();
  await parseJsonBody(req, deleteSchema);

  const workspaces = await prisma.workspace.findMany({
    where: { members: { some: { userId: session.user.id } } },
    select: { id: true },
  });
  const storage = getStorage();
  for (const workspace of workspaces) {
    await storage.deletePrefix(`workspaces/${workspace.id}`).catch((err) => {
      console.error("[account.delete] storage purge failed", err);
    });
  }

  await audit({ userId: session.user.id, action: "account.delete" });
  await prisma.user.delete({ where: { id: session.user.id } });
  return ok({ deleted: true });
});
