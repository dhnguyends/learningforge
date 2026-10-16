import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { detectLanguage, normalizeLanguage } from "@/lib/language";
import type { TranslationStatus } from "@/lib/pipelines/translate";

/**
 * The reader of one source: transcript segments for audio / video, passages
 * for documents, each with its text in the original language and in every
 * language it was translated into (English for French sources, plus any
 * reading translation). Read-aloud speaks one item at a time.
 */
export interface ReaderItem {
  /** Transcript segment id or passage (chunk) id. */
  id: string;
  index: number;
  startMs: number | null;
  endMs: number | null;
  page: number | null;
  speaker: string | null;
  /** Text by language code ("fr", "en", "es", "zh-Hans"…). */
  text: Record<string, string>;
  /** Languages whose text was corrected by hand (set by the reader API). */
  edited?: string[];
}

export interface SourceReader {
  kind: "segments" | "passages";
  /** Language of the original text (detected at import; "en" when unknown). */
  original: string;
  /** Languages every item can be shown in, original first. */
  languages: string[];
  /** French → English translation for search (vectorized). */
  translation: TranslationStatus | null;
  /** Reading translations by language (not vectorized), including running and failed ones. */
  readingTranslations: Record<string, TranslationStatus>;
  items: ReaderItem[];
}

export async function loadSourceReader(sourceId: string): Promise<SourceReader> {
  const source = await prisma.source.findUniqueOrThrow({
    where: { id: sourceId },
    select: {
      language: true,
      metadata: true,
      transcripts: {
        where: { isPrimary: true },
        take: 1,
        select: { language: true, segments: { orderBy: { idx: "asc" }, select: { id: true, startMs: true, endMs: true, speaker: true, text: true, translations: true } } },
      },
    },
  });
  const metadata = (source.metadata as Record<string, unknown> | null) ?? {};
  const translation = (metadata.translation as TranslationStatus | undefined) ?? null;
  const readingTranslations = (metadata.readingTranslations as Record<string, TranslationStatus> | undefined) ?? {};
  const segments = source.transcripts[0]?.segments ?? [];

  if (segments.length > 0) {
    const original =
      normalizeLanguage(source.language) ??
      detectLanguage(segments.slice(0, 80).map((s) => s.text).join(" ")) ??
      normalizeLanguage(source.transcripts[0]?.language) ??
      "en";
    const items = segments.map((s, index) => ({
      id: s.id,
      index,
      startMs: s.startMs,
      endMs: s.endMs,
      page: null,
      speaker: s.speaker,
      text: { ...textsOf(s.translations, original), [original]: s.text },
    }));
    return { kind: "segments", original, languages: languagesOf(items, original), translation, readingTranslations, items };
  }

  const passages = await prisma.extractedChunk.findMany({
    where: { sourceId, translationOfId: null },
    orderBy: { ordinal: "asc" },
    select: {
      id: true,
      content: true,
      page: true,
      startMs: true,
      endMs: true,
      speaker: true,
      readingTranslations: true,
      translations: { select: { language: true, content: true } },
    },
  });
  const original =
    normalizeLanguage(source.language) ?? detectLanguage(passages.slice(0, 10).map((p) => p.content).join(" ")) ?? "en";
  const items = passages.map((p, index) => {
    const text: Record<string, string> = textsOf(p.readingTranslations, original);
    for (const t of p.translations) {
      if (t.language && t.language !== original && t.content.trim()) text[t.language] = t.content;
    }
    text[original] = p.content;
    return { id: p.id, index, startMs: p.startMs, endMs: p.endMs, page: p.page, speaker: p.speaker, text };
  });
  return { kind: "passages", original, languages: languagesOf(items, original), translation, readingTranslations, items };
}

function textsOf(value: unknown, original: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [lang, text] of Object.entries(value as Record<string, unknown>)) {
    if (lang !== original && typeof text === "string" && text.trim()) out[lang] = text;
  }
  return out;
}

/** The original, plus each language every non-empty item has been translated into (alphabetical). */
export function languagesOf(items: Pick<ReaderItem, "text">[], original: string): string[] {
  const candidates = new Set(items.flatMap((i) => Object.keys(i.text)));
  candidates.delete(original);
  const complete = [...candidates]
    .filter((l) => items.length > 0 && items.every((i) => i.text[l] || !i.text[original]?.trim()))
    .sort();
  return [original, ...complete];
}

/**
 * Storage key of a cached read-aloud clip. The text hash and speaker id are
 * part of it, so a re-import, a new translation or another voice never replays
 * stale audio.
 */
export function speechCacheKey(prefix: string, speakerId: string, lang: string, kind: SourceReader["kind"], index: number, text: string, ext: string): string {
  const hash = createHash("sha256").update(text).digest("hex").slice(0, 16);
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${prefix}/tts/${safe(speakerId)}/${safe(lang)}/${kind}-${index}-${hash}.${ext}`;
}
