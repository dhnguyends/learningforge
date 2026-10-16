import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiHandler, ok, requireSession, notFound, badRequest, ApiError } from "@/lib/api";
import { assertStudySetAccess } from "@/lib/access";
import { audit } from "@/lib/audit";
import { detectLanguage } from "@/lib/language";
import { deleteTranslation, translateForReading, translateSource, translationTarget, type TranslationStatus } from "@/lib/pipelines/translate";
import { activeTranslatorProvider } from "@/lib/translation";
import { languageName, translationLanguages } from "@/lib/speech/languages";
import { loadSourceReader } from "@/lib/speech/reader";

type Ctx = { params: { studySetId: string; sourceId: string } };

const bodySchema = z.object({ to: z.string().trim().min(2).max(16).optional() }).optional();

/**
 * Translate a READY source now, in the background (a lecture takes minutes
 * with the local model); the source page follows the status.
 *
 * - Without `to`: the French → English translation used by search (for
 *   sources imported before translation existed, or to retry a failure).
 * - With `to`: a reading translation into any language the active translator
 *   offers — shown and read aloud on the source page, never vectorized.
 */
export const POST = apiHandler<Ctx>(async (req, { params }) => {
  const session = await requireSession();
  const studySet = await assertStudySetAccess(session.user.id, params.studySetId, "write");
  const body = bodySchema.parse(await req.json().catch(() => undefined));
  const source = await prisma.source.findFirst({
    where: { id: params.sourceId, studySetId: studySet.id },
    select: { id: true, status: true, language: true, metadata: true },
  });
  if (!source) throw notFound("Source");
  if (source.status !== "READY") throw badRequest("Wait for the import to finish before translating.");
  const metadata = (source.metadata as { translation?: TranslationStatus; readingTranslations?: Record<string, TranslationStatus> } | null) ?? {};
  const running = [metadata.translation, ...Object.values(metadata.readingTranslations ?? {})].some((t) => t?.status === "running");
  if (running) throw new ApiError(409, "This source is already being translated", "already_translating");

  if (body?.to) {
    const reader = await loadSourceReader(source.id);
    const to = (await translationLanguages(await activeTranslatorProvider())).find((l) => l.code.toLowerCase() === body.to!.toLowerCase())?.code;
    if (!to) throw badRequest(`The translator does not offer "${body.to}".`);
    if (to.toLowerCase() === reader.original.toLowerCase()) throw badRequest(`The source is already in ${languageName(to)}.`);
    await audit({ userId: session.user.id, action: "source.translate", entityType: "source", entityId: source.id, metadata: { from: reader.original, to, reading: true } });
    void translateForReading(source.id, reader.original, to).catch((err) => console.error("[translate] reading", source.id, to, err));
    return ok({ started: true, to }, { status: 202 });
  }

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
    if (!translationTarget(language)) throw badRequest("Only French sources are translated to English for search; choose a language to translate this one for reading.");
    await prisma.source.update({ where: { id: source.id }, data: { language } });
    await prisma.extractedChunk.updateMany({ where: { sourceId: source.id, translationOfId: null }, data: { language } });
  }

  await audit({ userId: session.user.id, action: "source.translate", entityType: "source", entityId: source.id, metadata: { from: language } });
  void translateSource(source.id).catch((err) => console.error("[translate] source", source.id, err));
  return ok({ started: true, to: "en" }, { status: 202 });
});

/**
 * Delete the translation into `?to=` (a reading translation, or the English
 * search translation of a French source), e.g. to translate it again. The
 * original text is kept; the source page then offers to translate again.
 */
export const DELETE = apiHandler<Ctx>(async (req, { params }) => {
  const session = await requireSession();
  const studySet = await assertStudySetAccess(session.user.id, params.studySetId, "write");
  const to = new URL(req.url).searchParams.get("to")?.trim();
  if (!to) throw badRequest("Say which translation to delete (?to=fr).");
  const source = await prisma.source.findFirst({
    where: { id: params.sourceId, studySetId: studySet.id },
    select: { id: true, metadata: true },
  });
  if (!source) throw notFound("Source");
  const reader = await loadSourceReader(source.id);
  const lang = [...reader.languages, ...Object.keys(reader.readingTranslations), ...(reader.translation?.to ? [reader.translation.to] : [])].find(
    (l) => l.toLowerCase() === to.toLowerCase(),
  );
  if (lang && lang === reader.original) throw badRequest("The original text cannot be deleted here.");
  if (!lang) throw notFound("Translation");
  const metadata = (source.metadata as { translation?: TranslationStatus; readingTranslations?: Record<string, TranslationStatus> } | null) ?? {};
  if (metadata.readingTranslations?.[lang]?.status === "running" || (metadata.translation?.status === "running" && metadata.translation.to === lang)) {
    throw new ApiError(409, "This translation is running: wait for it to finish before deleting it.", "already_translating");
  }
  const removed = await deleteTranslation(source.id, lang);
  await audit({ userId: session.user.id, action: "source.translation_deleted", entityType: "source", entityId: source.id, metadata: { lang, ...removed } });
  return ok({ deleted: lang, ...removed });
});
