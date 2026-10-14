import { z } from "zod";
import { prisma, jsonSafe } from "@/lib/db";
import { apiHandler, ok, parseJsonBody, requireSession, notFound } from "@/lib/api";
import { assertStudySetAccess } from "@/lib/access";
import { startGeneration } from "@/lib/api/generations";

type Ctx = { params: { studySetId: string; sectionId: string } };

/** Edit a guide section (first-class editing with version snapshots). */
const patchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().max(60_000).optional(),
  note: z.string().max(500).optional(),
});

export const PATCH = apiHandler<Ctx>(async (req, { params }) => {
  const session = await requireSession();
  const studySet = await assertStudySetAccess(session.user.id, params.studySetId, "write");
  const section = await prisma.studyGuideSection.findFirst({
    where: { id: params.sectionId, guide: { studySetId: studySet.id } },
  });
  if (!section) throw notFound("Section");

  const body = await parseJsonBody(req, patchSchema);

  // Version snapshot before the edit lands.
  await prisma.artifactEdit.create({
    data: {
      entityType: "guide_section",
      entityId: section.id,
      version: section.version,
      snapshot: { title: section.title, content: section.content, claimType: section.claimType, warnings: section.warnings },
      ...(body.note ? { note: body.note } : {}),
      editedById: session.user.id,
    },
  });

  const updated = await prisma.studyGuideSection.update({
    where: { id: section.id },
    data: {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.content !== undefined ? { content: body.content } : {}),
      edited: true,
      version: { increment: 1 },
    },
    include: { anchors: { include: { source: { select: { id: true, title: true, type: true } } } } },
  });
  return ok(jsonSafe({ section: updated }));
});

/** Selective regeneration of a single section (not the whole guide). */
export const POST = apiHandler<Ctx>(async (_req, { params }) => {
  const session = await requireSession();
  const studySet = await assertStudySetAccess(session.user.id, params.studySetId, "write");
  const section = await prisma.studyGuideSection.findFirst({
    where: { id: params.sectionId, guide: { studySetId: studySet.id } },
  });
  if (!section) throw notFound("Section");

  const { jobId } = await startGeneration({
    userId: session.user.id,
    studySetId: studySet.id,
    type: "GENERATE_GUIDE",
    jobName: "generate.guide",
    payload: { guideId: section.guideId, style: undefined, sectionIds: [section.id] },
  });
  return ok({ jobId }, { status: 202 });
});
