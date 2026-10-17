import { z } from "zod";
import { apiHandler, ok, parseJsonBody, requireAdmin } from "@/lib/api";
import { audit } from "@/lib/audit";
import { restoreVersion } from "@/lib/polylingue/review";

type Ctx = { params: { lessonId: string } };

/** Restores an earlier version of the lesson (the current one is kept too). */
export const POST = apiHandler<Ctx>(async (req, { params }) => {
  const session = await requireAdmin();
  const { version } = await parseJsonBody(req, z.object({ version: z.number().int().min(1) }));
  await restoreVersion(session.user.id, params.lessonId, version);
  await audit({ userId: session.user.id, action: "polylingue.lesson_restore", entityType: "lang_lesson", entityId: params.lessonId, metadata: { version } });
  return ok({ ok: true });
});
