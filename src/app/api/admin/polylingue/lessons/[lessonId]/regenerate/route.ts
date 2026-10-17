import { apiHandler, ok, requireAdmin } from "@/lib/api";
import { audit } from "@/lib/audit";
import { regenerateLesson } from "@/lib/polylingue/review";

type Ctx = { params: { lessonId: string } };

/** Writes the lesson again with the AI model (the current version is kept). */
export const POST = apiHandler<Ctx>(async (_req, { params }) => {
  const session = await requireAdmin();
  await regenerateLesson(session.user.id, params.lessonId);
  await audit({ userId: session.user.id, action: "polylingue.lesson_regenerate", entityType: "lang_lesson", entityId: params.lessonId });
  return ok({ ok: true }, { status: 202 });
});
