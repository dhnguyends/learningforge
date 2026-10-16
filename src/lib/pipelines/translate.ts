import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getTranslator } from "@/lib/translation";
import { indexTranslations } from "@/lib/retrieval";
import { normalizeLanguage, type SourceLanguage } from "@/lib/language";

/** What source.metadata.translation records (shown on the source page). */
export interface TranslationStatus {
  status: "running" | "done" | "failed";
  from: SourceLanguage;
  to: SourceLanguage;
  translator?: string;
  passages?: number;
  segments?: number;
  error?: string;
  at: string;
}

/** The language a source is translated into: French sources get English, nothing else is translated yet. */
export function translationTarget(language: string | null | undefined): SourceLanguage | null {
  return normalizeLanguage(language) === "fr" ? "en" : null;
}

/**
 * Makes a French source bilingual: every passage gets an English sibling
 * passage (same page / timestamps, its own embedding, so English questions find
 * it), and every transcript segment gets its English text for the reader and
 * read-aloud. The originals are untouched and stay what citations point at.
 *
 * Runs after the source is READY (the import gate never waits for it) and
 * records its progress in source.metadata.translation. Returns null when the
 * source is not in a language that is translated.
 */
export async function translateSource(sourceId: string): Promise<TranslationStatus | null> {
  const source = await prisma.source.findUnique({
    where: { id: sourceId },
    select: { id: true, language: true, transcripts: { select: { id: true }, where: { isPrimary: true }, take: 1 } },
  });
  const from = normalizeLanguage(source?.language);
  const to = translationTarget(source?.language);
  if (!source || !from || !to) return null;

  await recordStatus(sourceId, { status: "running", from, to, at: new Date().toISOString() });
  try {
    const translator = await getTranslator();
    const passages = await prisma.extractedChunk.findMany({
      where: { sourceId, translationOfId: null },
      orderBy: { ordinal: "asc" },
      select: { id: true, sourceId: true, ordinal: true, kind: true, content: true, page: true, startMs: true, endMs: true },
    });
    const passageTexts = await translator.translate(passages.map((p) => p.content), from, to);
    const indexed = await indexTranslations(sourceId, passages, passageTexts, to);

    let segments = 0;
    const transcriptId = source.transcripts[0]?.id;
    if (transcriptId) {
      const rows = await prisma.transcriptSegment.findMany({
        where: { transcriptId },
        orderBy: { idx: "asc" },
        select: { id: true, text: true, translations: true },
      });
      const texts = await translator.translate(rows.map((r) => r.text), from, to);
      await prisma.$transaction(
        rows.map((r, i) =>
          prisma.transcriptSegment.update({
            where: { id: r.id },
            data: { translations: { ...((r.translations as Record<string, string> | null) ?? {}), [to]: texts[i] ?? "" } },
          }),
        ),
      );
      segments = rows.length;
    }

    const done: TranslationStatus = {
      status: "done",
      from,
      to,
      translator: translator.name,
      passages: indexed,
      segments,
      at: new Date().toISOString(),
    };
    await recordStatus(sourceId, done);
    return done;
  } catch (err) {
    const failed: TranslationStatus = {
      status: "failed",
      from,
      to,
      error: err instanceof Error ? err.message : String(err),
      at: new Date().toISOString(),
    };
    await recordStatus(sourceId, failed);
    return failed;
  }
}

async function recordStatus(sourceId: string, translation: TranslationStatus): Promise<void> {
  const row = await prisma.source.findUnique({ where: { id: sourceId }, select: { metadata: true } });
  if (!row) return;
  await prisma.source.update({
    where: { id: sourceId },
    data: { metadata: { ...((row.metadata as Prisma.JsonObject | null) ?? {}), translation: translation as unknown as Prisma.JsonObject } },
  });
}
