import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getTranslator } from "@/lib/translation";
import { indexTranslations } from "@/lib/retrieval";
import { normalizeLanguage, type SourceLanguage } from "@/lib/language";

/** What source.metadata.translation records (shown on the source page). */
export interface TranslationStatus {
  status: "running" | "done" | "failed";
  from: string;
  to: string;
  translator?: string;
  passages?: number;
  segments?: number;
  error?: string;
  at: string;
  /** While running: items translated so far out of `total`, since `startedAt` (for the progress bar). */
  done?: number;
  total?: number;
  startedAt?: string;
}

/**
 * Progress reporter for a running translation: writes `done / total` into the
 * status at most every 750 ms (and always at the end), so a long lecture does
 * not hammer the database.
 */
function progressWriter(write: (status: TranslationStatus) => Promise<void>, base: TranslationStatus) {
  let last = 0;
  return async (done: number, total: number) => {
    const now = Date.now();
    if (done < total && now - last < 750) return;
    last = now;
    await write({ ...base, status: "running", done, total, at: new Date().toISOString() });
  };
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

  const startedAt = new Date().toISOString();
  await recordStatus(sourceId, { status: "running", from, to, at: startedAt, startedAt, done: 0 });
  try {
    const translator = await getTranslator();
    const passages = await prisma.extractedChunk.findMany({
      where: { sourceId, translationOfId: null },
      orderBy: { ordinal: "asc" },
      select: { id: true, sourceId: true, ordinal: true, kind: true, content: true, page: true, startMs: true, endMs: true },
    });
    const transcriptId = source.transcripts[0]?.id;
    const rows = transcriptId
      ? await prisma.transcriptSegment.findMany({
          where: { transcriptId },
          orderBy: { idx: "asc" },
          select: { id: true, text: true, translations: true },
        })
      : [];
    const total = passages.length + rows.length;
    const progress = progressWriter((s) => recordStatus(sourceId, s), { status: "running", from, to, at: startedAt, startedAt, translator: translator.name });

    const passageTexts = await translator.translate(passages.map((p) => p.content), from, to, (done) => progress(done, total));
    const indexed = await indexTranslations(sourceId, passages, passageTexts, to);

    let segments = 0;
    if (rows.length > 0) {
      const texts = await translator.translate(rows.map((r) => r.text), from, to, (done) => progress(passages.length + done, total));
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
      startedAt,
      done: total,
      total,
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

/**
 * Reading translation: the source's transcript segments and passages in
 * another language (any the translator offers), for the reader and read-aloud
 * only. Nothing is embedded or searchable, so it does not change retrieval or
 * generation. Stored in segment.translations[to] and chunk.readingTranslations[to];
 * progress in source.metadata.readingTranslations[to].
 */
export async function translateForReading(sourceId: string, from: string, to: string): Promise<TranslationStatus> {
  const startedAt = new Date().toISOString();
  await recordReadingStatus(sourceId, to, { status: "running", from, to, at: startedAt, startedAt, done: 0 });
  try {
    const translator = await getTranslator();
    const progress = progressWriter((s) => recordReadingStatus(sourceId, to, s), {
      status: "running",
      from,
      to,
      at: startedAt,
      startedAt,
      translator: translator.name,
    });
    const passages = await prisma.extractedChunk.findMany({
      where: { sourceId, translationOfId: null },
      orderBy: { ordinal: "asc" },
      select: { id: true, content: true, readingTranslations: true },
    });
    const transcript = await prisma.transcript.findFirst({ where: { sourceId, isPrimary: true }, select: { id: true } });
    const segments = transcript
      ? await prisma.transcriptSegment.findMany({
          where: { transcriptId: transcript.id },
          orderBy: { idx: "asc" },
          select: { id: true, text: true, translations: true },
        })
      : [];

    // Audio / video show their transcript; documents show their passages.
    if (segments.length > 0) {
      const texts = await translator.translate(segments.map((r) => r.text), from, to, progress);
      await prisma.$transaction(
        segments.map((r, i) =>
          prisma.transcriptSegment.update({
            where: { id: r.id },
            data: { translations: { ...asRecord(r.translations), [to]: texts[i] ?? "" } },
          }),
        ),
      );
    } else {
      const texts = await translator.translate(passages.map((p) => p.content), from, to, progress);
      await prisma.$transaction(
        passages.map((p, i) =>
          prisma.extractedChunk.update({
            where: { id: p.id },
            data: { readingTranslations: { ...asRecord(p.readingTranslations), [to]: texts[i] ?? "" } },
          }),
        ),
      );
    }
    const done: TranslationStatus = {
      status: "done",
      from,
      to,
      translator: translator.name,
      passages: segments.length > 0 ? 0 : passages.length,
      segments: segments.length,
      at: new Date().toISOString(),
      startedAt,
      done: segments.length || passages.length,
      total: segments.length || passages.length,
    };
    await recordReadingStatus(sourceId, to, done);
    return done;
  } catch (err) {
    const failed: TranslationStatus = { status: "failed", from, to, error: err instanceof Error ? err.message : String(err), at: new Date().toISOString() };
    await recordReadingStatus(sourceId, to, failed);
    return failed;
  }
}

function asRecord(value: unknown): Record<string, string> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, string>) : {};
}

async function recordReadingStatus(sourceId: string, lang: string, status: TranslationStatus): Promise<void> {
  const row = await prisma.source.findUnique({ where: { id: sourceId }, select: { metadata: true } });
  if (!row) return;
  const metadata = (row.metadata as Prisma.JsonObject | null) ?? {};
  const reading = (metadata.readingTranslations as Prisma.JsonObject | undefined) ?? {};
  await prisma.source.update({
    where: { id: sourceId },
    data: { metadata: { ...metadata, readingTranslations: { ...reading, [lang]: status as unknown as Prisma.JsonObject } } },
  });
}

/**
 * Deletes a source's translation into one language: the transcript segments'
 * and passages' text in that language, the searchable passages if it is the
 * search translation, its status, and the record of hand corrections made to
 * it. The original is never touched. Returns how many items lost their text.
 */
export async function deleteTranslation(sourceId: string, lang: string): Promise<{ segments: number; passages: number; search: boolean }> {
  const source = await prisma.source.findUniqueOrThrow({
    where: { id: sourceId },
    select: { metadata: true, transcripts: { select: { id: true } } },
  });
  const transcriptIds = source.transcripts.map((t) => t.id);
  const segmentRows = transcriptIds.length
    ? await prisma.transcriptSegment.findMany({ where: { transcriptId: { in: transcriptIds } }, select: { id: true, translations: true } })
    : [];
  const passageRows = await prisma.extractedChunk.findMany({ where: { sourceId, translationOfId: null }, select: { id: true, readingTranslations: true } });
  const without = (value: unknown) => {
    const { [lang]: _gone, ...rest } = asRecord(value);
    return rest;
  };
  const segments = segmentRows.filter((r) => lang in asRecord(r.translations));
  const passages = passageRows.filter((r) => lang in asRecord(r.readingTranslations));
  const metadata = (source.metadata as Prisma.JsonObject | null) ?? {};
  const { [lang]: _status, ...reading } = (metadata.readingTranslations as Prisma.JsonObject | undefined) ?? {};
  const searchStatus = metadata.translation as { to?: string } | undefined;
  const nextMetadata: Prisma.JsonObject = { ...metadata, readingTranslations: reading };
  if (searchStatus?.to === lang) delete nextMetadata.translation;

  const [searchDeleted] = await prisma.$transaction([
    prisma.extractedChunk.deleteMany({ where: { sourceId, language: lang, translationOfId: { not: null } } }),
    ...segments.map((r) => prisma.transcriptSegment.update({ where: { id: r.id }, data: { translations: without(r.translations) } })),
    ...passages.map((r) => prisma.extractedChunk.update({ where: { id: r.id }, data: { readingTranslations: without(r.readingTranslations) } })),
    prisma.source.update({ where: { id: sourceId }, data: { metadata: nextMetadata } }),
    prisma.artifactEdit.deleteMany({
      where: {
        entityType: "source_text",
        entityId: { in: [...segmentRows, ...passageRows].map((r) => r.id) },
        snapshot: { path: ["lang"], equals: lang },
      },
    }),
  ]);
  return { segments: segments.length, passages: Math.max(passages.length, searchDeleted.count), search: searchDeleted.count > 0 };
}
