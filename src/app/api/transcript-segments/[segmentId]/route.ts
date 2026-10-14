import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiHandler, ok, parseJsonBody, requireSession, notFound } from "@/lib/api";
import { assertStudySetAccess } from "@/lib/access";

type Ctx = { params: { segmentId: string } };

/** Transcript editing: fix text, flag inaccuracy, add private notes. */
const patchSchema = z.object({
  text: z.string().max(4000).optional(),
  flagged: z.boolean().optional(),
  note: z.string().max(2000).nullable().optional(),
});

export const PATCH = apiHandler<Ctx>(async (req, { params }) => {
  const session = await requireSession();
  const segment = await prisma.transcriptSegment.findUnique({
    where: { id: params.segmentId },
    include: { transcript: { include: { source: { select: { studySetId: true } } } } },
  });
  if (!segment) throw notFound("Transcript segment");
  await assertStudySetAccess(session.user.id, segment.transcript.source.studySetId, "write");

  const body = await parseJsonBody(req, patchSchema);
  const updated = await prisma.transcriptSegment.update({
    where: { id: params.segmentId },
    data: {
      ...(body.text !== undefined ? { text: body.text, edited: true } : {}),
      ...(body.flagged !== undefined ? { flagged: body.flagged } : {}),
      ...(body.note !== undefined ? { note: body.note } : {}),
    },
  });
  return ok({ segment: updated });
});
