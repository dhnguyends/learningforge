import { z } from "zod";
import { prisma, jsonSafe } from "@/lib/db";
import { apiHandler, ok, parseJsonBody, requireSession, notFound } from "@/lib/api";
import { assertStudySetAccess } from "@/lib/access";
import { assertSourcesIndexed, startGeneration } from "@/lib/api/generations";

type Ctx = { params: { studySetId: string } };

export const GET = apiHandler<Ctx>(async (req, { params }) => {
  const session = await requireSession();
  const studySet = await assertStudySetAccess(session.user.id, params.studySetId);
  const style = req.nextUrl.searchParams.get("style");

  const guide = await prisma.studyGuide.findFirst({
    where: { studySetId: studySet.id, ...(style ? { style: style as never } : {}) },
    orderBy: { createdAt: "desc" },
    include: {
      sections: {
        orderBy: { ordinal: "asc" },
        include: { anchors: { include: { source: { select: { id: true, title: true, type: true } } } } },
      },
    },
  });
  if (!guide) return ok({ guide: null });
  return ok(jsonSafe({ guide }));
});

const generateSchema = z.object({
  style: z.enum(["EXAM_REVISION", "LECTURE_NOTES", "TECHNICAL_OUTLINE", "CORNELL", "PAPER_NOTES"]).default("LECTURE_NOTES"),
  regenerate: z.boolean().default(false),
});

export const POST = apiHandler<Ctx>(async (req, { params }) => {
  const session = await requireSession();
  const studySet = await assertStudySetAccess(session.user.id, params.studySetId, "write");
  await assertSourcesIndexed(studySet.id);
  const body = await parseJsonBody(req, generateSchema);

  // One guide per style per study set; regenerate reuses the row.
  const existing = await prisma.studyGuide.findFirst({ where: { studySetId: studySet.id, style: body.style } });
  const guide = existing
    ? await prisma.studyGuide.update({ where: { id: existing.id }, data: { status: "QUEUED" } })
    : await prisma.studyGuide.create({
        data: { studySetId: studySet.id, style: body.style, title: `${studySet.title} — study guide` },
      });

  const { jobId } = await startGeneration({
    userId: session.user.id,
    studySetId: studySet.id,
    type: "GENERATE_GUIDE",
    jobName: "generate.guide",
    payload: { guideId: guide.id, style: body.style },
  });
  return ok({ guideId: guide.id, jobId }, { status: 202 });
});
