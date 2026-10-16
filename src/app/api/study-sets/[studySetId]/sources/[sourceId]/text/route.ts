import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiHandler, ok, parseJsonBody, requireSession, notFound, badRequest } from "@/lib/api";
import { assertStudySetAccess } from "@/lib/access";
import { audit } from "@/lib/audit";
import { MAX_ITEM_CHARS, saveSourceText } from "@/lib/documents/source-text";

type Ctx = { params: { studySetId: string; sourceId: string } };

const bodySchema = z.object({
  lang: z.string().min(2).max(12),
  edits: z.array(z.object({ id: z.string().min(1).max(64), text: z.string().max(MAX_ITEM_CHARS) })).min(1).max(5000),
});

/** Save hand corrections of a source's text (original or a translation); search is re-indexed where it uses that text. */
export const PUT = apiHandler<Ctx>(async (req, { params }) => {
  const session = await requireSession();
  const studySet = await assertStudySetAccess(session.user.id, params.studySetId, "write");
  const source = await prisma.source.findFirst({ where: { id: params.sourceId, studySetId: studySet.id }, select: { id: true, status: true } });
  if (!source) throw notFound("Source");
  if (source.status !== "READY") throw badRequest("The source is still being processed: edit its text when it is ready.");

  const body = await parseJsonBody(req, bodySchema);
  const result = await saveSourceText(source.id, session.user.id, body.lang, body.edits);
  if (result.saved > 0) {
    await audit({
      userId: session.user.id,
      action: "source.text_edited",
      entityType: "source",
      entityId: source.id,
      metadata: { lang: body.lang, saved: result.saved, reindexed: result.reindexed },
    });
  }
  return ok(result);
});
