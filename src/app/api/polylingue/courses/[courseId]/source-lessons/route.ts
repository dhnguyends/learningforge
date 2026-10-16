import { z } from "zod";
import { apiHandler, ok, parseJsonBody, requireSession } from "@/lib/api";
import { createSourceLesson, eligibleSources, sourceLessonParts } from "@/lib/polylingue/source-lessons";

type Ctx = { params: { courseId: string } };

/**
 * Learn from your own material.
 *   GET  …/source-lessons            your sources available in the language you learn
 *   GET  …/source-lessons?source=ID  how many lesson parts that source offers
 *   POST …/source-lessons {sourceId, part}  creates a personal lesson from that part
 */
export const GET = apiHandler<Ctx>(async (req, { params }) => {
  const session = await requireSession();
  const sourceId = new URL(req.url).searchParams.get("source");
  if (sourceId) return ok(await sourceLessonParts(session.user.id, params.courseId, sourceId));
  return ok({ sources: await eligibleSources(session.user.id, params.courseId) });
});

const schema = z.object({ sourceId: z.string().min(1), part: z.number().int().min(0).max(500) });

export const POST = apiHandler<Ctx>(async (req, { params }) => {
  const session = await requireSession();
  return ok(await createSourceLesson(session.user.id, params.courseId, await parseJsonBody(req, schema)), { status: 201 });
});
