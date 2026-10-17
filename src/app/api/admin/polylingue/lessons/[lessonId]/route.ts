import { z } from "zod";
import { apiHandler, ok, parseJsonBody, requireAdmin } from "@/lib/api";
import { audit } from "@/lib/audit";
import { lessonForReview, saveLessonEdit } from "@/lib/polylingue/review";

type Ctx = { params: { lessonId: string } };

const schema = z.object({ title: z.string().trim().min(1).max(160).optional(), content: z.unknown(), note: z.string().trim().max(200).optional() });

/** One lesson for review: content, reports per exercise, earlier versions. */
export const GET = apiHandler<Ctx>(async (_req, { params }) => {
  await requireAdmin();
  return ok(await lessonForReview(params.lessonId));
});

/** Saves an admin's corrections (the previous version is kept). */
export const PUT = apiHandler<Ctx>(async (req, { params }) => {
  const session = await requireAdmin();
  const result = await saveLessonEdit(session.user.id, params.lessonId, await parseJsonBody(req, schema));
  await audit({ userId: session.user.id, action: "polylingue.lesson_edit", entityType: "lang_lesson", entityId: params.lessonId, metadata: { changed: result.changed } });
  return ok(result);
});
