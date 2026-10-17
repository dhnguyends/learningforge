import { apiHandler, ok, requireAdmin, notFound } from "@/lib/api";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { pregenerateLessonAudio } from "@/lib/polylingue/voices";

type Ctx = { params: { curriculumId: string } };

/** Generates, in the background, the audio of every ready lesson of the course (local voices only). */
export const POST = apiHandler<Ctx>(async (_req, { params }) => {
  const session = await requireAdmin();
  const curriculum = await prisma.langCurriculum.findUnique({ where: { id: params.curriculumId }, select: { id: true } });
  if (!curriculum) throw notFound("Course");
  const lessons = await prisma.langLesson.findMany({ where: { curriculumId: curriculum.id, status: "READY", retiredAt: null }, select: { id: true }, orderBy: { ordinal: "asc" } });
  for (const l of lessons) void pregenerateLessonAudio(l.id).catch((err) => console.warn("[polylingue] audio", l.id, err instanceof Error ? err.message : err));
  await audit({ userId: session.user.id, action: "polylingue.audio_pregenerate", entityType: "lang_curriculum", entityId: curriculum.id, metadata: { lessons: lessons.length } });
  return ok({ queued: lessons.length }, { status: 202 });
});
