import { prisma } from "@/lib/db";
import { apiHandler, ok, requireSession, notFound } from "@/lib/api";
import { assertStudySetAccess } from "@/lib/access";
import { loadSourceReader } from "@/lib/speech/reader";

type Ctx = { params: { studySetId: string; sourceId: string } };

/** The source's text in its original language and, once translated, in the other one. */
export const GET = apiHandler<Ctx>(async (_req, { params }) => {
  const session = await requireSession();
  const studySet = await assertStudySetAccess(session.user.id, params.studySetId, "read");
  const source = await prisma.source.findFirst({ where: { id: params.sourceId, studySetId: studySet.id }, select: { id: true } });
  if (!source) throw notFound("Source");
  return ok(await loadSourceReader(source.id));
});
