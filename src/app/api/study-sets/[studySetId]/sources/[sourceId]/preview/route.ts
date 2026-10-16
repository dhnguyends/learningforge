import { prisma } from "@/lib/db";
import { apiHandler, ok, requireSession, notFound, badRequest } from "@/lib/api";
import { assertStudySetAccess } from "@/lib/access";
import { getStorage } from "@/lib/storage";
import { DOCX_MIME, docxToSafeHtml } from "@/lib/documents/preview";

type Ctx = { params: { studySetId: string; sourceId: string } };

/** Readable preview of a Word source (sanitized HTML), which browsers cannot display themselves. */
export const GET = apiHandler<Ctx>(async (_req, { params }) => {
  const session = await requireSession();
  const studySet = await assertStudySetAccess(session.user.id, params.studySetId, "read");
  const source = await prisma.source.findFirst({
    where: { id: params.sourceId, studySetId: studySet.id },
    select: { assets: { where: { kind: "ORIGINAL" }, select: { storageKey: true, mimeType: true, filename: true } } },
  });
  if (!source) throw notFound("Source");
  const original = source.assets[0];
  if (!original) throw notFound("Original file");
  if (original.mimeType !== DOCX_MIME && !original.filename.toLowerCase().endsWith(".docx")) {
    throw badRequest("Only Word (.docx) sources have an HTML preview");
  }
  const html = await docxToSafeHtml(await getStorage().read(original.storageKey));
  return ok({ html }, { headers: { "Cache-Control": "private, max-age=300" } });
});
