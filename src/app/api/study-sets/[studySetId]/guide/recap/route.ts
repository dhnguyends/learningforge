import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiHandler, ok, parseJsonBody, requireSession, notFound } from "@/lib/api";
import { assertStudySetAccess } from "@/lib/access";
import { startGeneration } from "@/lib/api/generations";

type Ctx = { params: { studySetId: string } };

/** Generate (or regenerate) the audio recap of a study guide. */
export const POST = apiHandler<Ctx>(async (req, { params }) => {
  const session = await requireSession();
  const studySet = await assertStudySetAccess(session.user.id, params.studySetId, "write");
  const body = await parseJsonBody(req, z.object({ guideId: z.string().optional() }));

  const guide = await prisma.studyGuide.findFirst({
    where: { studySetId: studySet.id, ...(body.guideId ? { id: body.guideId } : {}) },
    orderBy: { createdAt: "desc" },
  });
  if (!guide) throw notFound("Study guide");
  if (guide.status !== "READY") throw notFound("Guide must be READY before generating a recap");

  const { jobId } = await startGeneration({
    userId: session.user.id,
    studySetId: studySet.id,
    type: "GENERATE_AUDIO_RECAP",
    jobName: "generate.audio-recap",
    payload: { guideId: guide.id },
  });
  return ok({ jobId }, { status: 202 });
});
