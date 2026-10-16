import { prisma } from "@/lib/db";
import { apiHandler, ok, requireSession, notFound, badRequest, ApiError } from "@/lib/api";
import { assertStudySetAccess } from "@/lib/access";
import { audit } from "@/lib/audit";
import { detectLanguage } from "@/lib/language";
import { translateSource, translationTarget, type TranslationStatus } from "@/lib/pipelines/translate";

type Ctx = { params: { studySetId: string; sourceId: string } };

/**
 * Translate a READY French source now — for sources imported before
 * translation existed, or to retry a failed translation — without importing
 * it again. Runs in the background; the source page follows
 * metadata.translation.
 */
export const POST = apiHandler<Ctx>(async (_req, { params }) => {
  const session = await requireSession();
  const studySet = await assertStudySetAccess(session.user.id, params.studySetId, "write");
  const source = await prisma.source.findFirst({
    where: { id: params.sourceId, studySetId: studySet.id },
    select: { id: true, status: true, language: true, metadata: true },
  });
  if (!source) throw notFound("Source");
  if (source.status !== "READY") throw badRequest("Wait for the import to finish before translating.");
  const current = (source.metadata as { translation?: TranslationStatus } | null)?.translation;
  if (current?.status === "running") throw new ApiError(409, "This source is already being translated", "already_translating");

  // Older imports have no language recorded: detect it from the passages.
  let language = source.language;
  if (!translationTarget(language)) {
    const sample = await prisma.extractedChunk.findMany({
      where: { sourceId: source.id, translationOfId: null },
      orderBy: { ordinal: "asc" },
      take: 10,
      select: { content: true },
    });
    language = detectLanguage(sample.map((c) => c.content).join(" ")) ?? language;
    if (!translationTarget(language)) throw badRequest("Only French sources are translated (to English).");
    await prisma.source.update({ where: { id: source.id }, data: { language } });
    await prisma.extractedChunk.updateMany({ where: { sourceId: source.id, translationOfId: null }, data: { language } });
  }

  await audit({ userId: session.user.id, action: "source.translate", entityType: "source", entityId: source.id, metadata: { from: language } });
  // Background: a lecture takes minutes with the local model.
  void translateSource(source.id).catch((err) => console.error("[translate] source", source.id, err));
  return ok({ started: true }, { status: 202 });
});
