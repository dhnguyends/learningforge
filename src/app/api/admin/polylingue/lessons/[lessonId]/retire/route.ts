import { z } from "zod";
import { apiHandler, ok, parseJsonBody, requireAdmin } from "@/lib/api";
import { audit } from "@/lib/audit";
import { setRetired } from "@/lib/polylingue/review";

type Ctx = { params: { lessonId: string } };

/** Retires a lesson (no longer offered) or brings it back. */
export const POST = apiHandler<Ctx>(async (req, { params }) => {
  const session = await requireAdmin();
  const { retired } = await parseJsonBody(req, z.object({ retired: z.boolean() }));
  await setRetired(session.user.id, params.lessonId, retired);
  await audit({ userId: session.user.id, action: retired ? "polylingue.lesson_retire" : "polylingue.lesson_unretire", entityType: "lang_lesson", entityId: params.lessonId });
  return ok({ retired });
});
