import { prisma } from "@/lib/db";
import { badRequest } from "@/lib/api";
import { getEmbeddings, toVectorLiteral } from "@/lib/ai/embeddings";
import { estimateTokens } from "@/lib/retrieval/chunking";
import { loadSourceReader, type SourceReader } from "@/lib/speech/reader";

/**
 * Hand corrections of a source's text, in its original language or in any
 * language it was translated into: transcript segments of a recording, or
 * passages of a document (OCR fixes, a better translation…).
 *
 * The text before each change is kept as an ArtifactEdit ("source_text"), and
 * whatever search uses is re-indexed: corrected passages and translated
 * passages get a new embedding, and a corrected transcript rebuilds the
 * passages that cover the changed segments. Reading translations are never
 * vectorized. Reprocessing the source (or a new translation into the same
 * language) replaces the corrections.
 */
export const SOURCE_TEXT_ENTITY = "source_text";
export const MAX_ITEM_CHARS = 20_000;

export interface TextEdit {
  id: string;
  text: string;
}

export interface SaveResult {
  saved: number;
  reindexed: number;
}

export async function saveSourceText(sourceId: string, userId: string, lang: string, edits: TextEdit[]): Promise<SaveResult> {
  const reader = await loadSourceReader(sourceId);
  if (!reader.languages.includes(lang)) throw badRequest(`This source has no ${lang} text to edit.`);
  const running = reader.readingTranslations[lang]?.status === "running" || (reader.translation?.status === "running" && reader.translation.to === lang);
  if (running) throw badRequest("A translation into this language is running: edit it when it has finished.");

  const byId = new Map(reader.items.map((i) => [i.id, i]));
  const changes: { id: string; before: string; text: string }[] = [];
  for (const edit of edits) {
    const item = byId.get(edit.id);
    if (!item) throw badRequest("Some of the edited text does not belong to this source; reload the page.");
    const text = normalizeEdit(edit.text);
    if (!text && lang === reader.original) throw badRequest("A passage of the original cannot be empty: write at least one word.");
    const before = item.text[lang] ?? "";
    if (text !== before) changes.push({ id: edit.id, before, text });
  }
  if (changes.length === 0) return { saved: 0, reindexed: 0 };

  await snapshot(userId, lang, changes);
  const reindexed = reader.kind === "segments" ? await saveSegments(sourceId, reader, lang, changes) : await savePassages(sourceId, reader, lang, changes);
  return { saved: changes.length, reindexed };
}

/** Line endings and trailing spaces normalised; inner line breaks (paragraphs) are kept. */
export function normalizeEdit(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function snapshot(userId: string, lang: string, changes: { id: string; before: string }[]) {
  const last = await prisma.artifactEdit.groupBy({
    by: ["entityId"],
    where: { entityType: SOURCE_TEXT_ENTITY, entityId: { in: changes.map((c) => c.id) } },
    _max: { version: true },
  });
  const version = new Map(last.map((l) => [l.entityId, l._max.version ?? 0]));
  await prisma.artifactEdit.createMany({
    data: changes.map((c) => ({
      entityType: SOURCE_TEXT_ENTITY,
      entityId: c.id,
      version: (version.get(c.id) ?? 0) + 1,
      snapshot: { lang, text: c.before },
      editedById: userId,
    })),
  });
}

async function saveSegments(sourceId: string, reader: SourceReader, lang: string, changes: { id: string; text: string }[]): Promise<number> {
  const original = lang === reader.original;
  const rows = await prisma.transcriptSegment.findMany({
    where: { id: { in: changes.map((c) => c.id) } },
    select: { id: true, translations: true },
  });
  const translations = new Map(rows.map((r) => [r.id, (r.translations as Record<string, string> | null) ?? {}]));
  await prisma.$transaction(
    changes.map((c) =>
      prisma.transcriptSegment.update({
        where: { id: c.id },
        data: original ? { text: c.text, edited: true } : { translations: { ...translations.get(c.id), [lang]: c.text } },
      }),
    ),
  );

  // Rebuild the passages (original, or the searchable translation in this language) that cover the changed segments.
  const changed = reader.items.filter((i) => changes.some((c) => c.id === i.id));
  const passages = await prisma.extractedChunk.findMany({
    where: { sourceId, kind: "TRANSCRIPT", ...(original ? { translationOfId: null } : { language: lang, translationOfId: { not: null } }) },
    select: { id: true, startMs: true, endMs: true },
  });
  const covering = (p: { startMs: number | null; endMs: number | null }) => (s: { startMs: number | null; endMs: number | null }) =>
    p.startMs != null && p.endMs != null && s.startMs != null && s.endMs != null && s.startMs >= p.startMs && s.endMs <= p.endMs;
  const updated = await loadSourceReader(sourceId);
  const rebuilt = passages
    .filter((p) => changed.some(covering(p)))
    .map((p) => ({
      id: p.id,
      content: updated.items
        .filter(covering(p))
        .map((s) => (s.text[lang] ?? "").trim())
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
    }))
    .filter((p) => p.content);
  await reembed(rebuilt);
  return rebuilt.length;
}

async function savePassages(sourceId: string, reader: SourceReader, lang: string, changes: { id: string; text: string }[]): Promise<number> {
  if (lang === reader.original) {
    await reembed(changes.map((c) => ({ id: c.id, content: c.text })));
    return changes.length;
  }
  // A searchable translation (a sibling passage in this language) is re-indexed; a reading translation is not.
  const siblings = await prisma.extractedChunk.findMany({
    where: { sourceId, language: lang, translationOfId: { in: changes.map((c) => c.id) } },
    select: { id: true, translationOfId: true },
  });
  const siblingOf = new Map(siblings.map((s) => [s.translationOfId, s.id]));
  const searchable = changes.filter((c) => siblingOf.has(c.id));
  await reembed(searchable.map((c) => ({ id: siblingOf.get(c.id)!, content: c.text })));

  const reading = changes.filter((c) => !siblingOf.has(c.id));
  if (reading.length > 0) {
    const rows = await prisma.extractedChunk.findMany({ where: { id: { in: reading.map((c) => c.id) } }, select: { id: true, readingTranslations: true } });
    const current = new Map(rows.map((r) => [r.id, (r.readingTranslations as Record<string, string> | null) ?? {}]));
    await prisma.$transaction(
      reading.map((c) =>
        prisma.extractedChunk.update({ where: { id: c.id }, data: { readingTranslations: { ...current.get(c.id), [lang]: c.text } } }),
      ),
    );
  }
  return searchable.length;
}

/** New content and embedding for passages search uses. */
async function reembed(passages: { id: string; content: string }[]) {
  if (passages.length === 0) return;
  const embeddings = getEmbeddings();
  const vectors = await embeddings.embed(passages.map((p) => p.content), { kind: "document" });
  for (const [i, p] of passages.entries()) {
    await prisma.extractedChunk.update({
      where: { id: p.id },
      data: { content: p.content, tokenCount: estimateTokens(p.content), embeddingModel: embeddings.name },
    });
    await prisma.$executeRawUnsafe(`UPDATE "extracted_chunks" SET embedding = $1::vector WHERE id = $2`, toVectorLiteral(vectors[i]), p.id);
  }
}

/** Languages corrected by hand, by reader item id. */
export async function editedLanguages(itemIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (itemIds.length === 0) return out;
  const rows = await prisma.artifactEdit.findMany({
    where: { entityType: SOURCE_TEXT_ENTITY, entityId: { in: itemIds } },
    select: { entityId: true, snapshot: true },
  });
  for (const r of rows) {
    const lang = (r.snapshot as { lang?: unknown } | null)?.lang;
    if (typeof lang !== "string") continue;
    const langs = out.get(r.entityId) ?? [];
    if (!langs.includes(lang)) langs.push(lang);
    out.set(r.entityId, langs);
  }
  return out;
}
