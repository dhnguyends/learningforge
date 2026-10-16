import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { detectLanguage, normalizeLanguage, type SourceLanguage } from "@/lib/language";
import type { TranslationStatus } from "@/lib/pipelines/translate";

/**
 * The bilingual reader of one source: transcript segments for audio / video,
 * passages for documents, each with its text in the original language and,
 * once translated, in the other one. Read-aloud speaks one item at a time.
 */
export interface ReaderItem {
  /** Transcript segment id or passage (chunk) id. */
  id: string;
  index: number;
  startMs: number | null;
  endMs: number | null;
  page: number | null;
  speaker: string | null;
  text: Partial<Record<SourceLanguage, string>>;
}

export interface SourceReader {
  kind: "segments" | "passages";
  /** Language of the original text (detected at import; "en" when unknown). */
  original: SourceLanguage;
  /** Languages every item can be shown in, original first. */
  languages: SourceLanguage[];
  translation: TranslationStatus | null;
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
  const translation = ((source.metadata as Record<string, unknown> | null)?.translation as TranslationStatus | undefined) ?? null;
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
      text: { ...translationsOf(s.translations, original), [original]: s.text },
    }));
    return { kind: "segments", original, languages: languagesOf(items, original), translation, items };
  }

  const passages = await prisma.extractedChunk.findMany({
    where: { sourceId, translationOfId: null },
    orderBy: { ordinal: "asc" },
    select: { id: true, content: true, page: true, startMs: true, endMs: true, speaker: true, translations: { select: { language: true, content: true } } },
  });
  const original =
    normalizeLanguage(source.language) ?? detectLanguage(passages.slice(0, 10).map((p) => p.content).join(" ")) ?? "en";
  const items = passages.map((p, index) => {
    const text: Partial<Record<SourceLanguage, string>> = {};
    for (const t of p.translations) {
      const lang = normalizeLanguage(t.language);
      if (lang && lang !== original) text[lang] = t.content;
    }
    text[original] = p.content;
    return { id: p.id, index, startMs: p.startMs, endMs: p.endMs, page: p.page, speaker: p.speaker, text };
  });
  return { kind: "passages", original, languages: languagesOf(items, original), translation, items };
}

function translationsOf(value: unknown, original: SourceLanguage): Partial<Record<SourceLanguage, string>> {
  const out: Partial<Record<SourceLanguage, string>> = {};
  if (!value || typeof value !== "object") return out;
  for (const [tag, text] of Object.entries(value as Record<string, unknown>)) {
    const lang = normalizeLanguage(tag);
    if (lang && lang !== original && typeof text === "string" && text.trim()) out[lang] = text;
  }
  return out;
}

/** The original, plus each language every non-empty item has been translated into. */
function languagesOf(items: ReaderItem[], original: SourceLanguage): SourceLanguage[] {
  const others = (["fr", "en"] as const).filter(
    (l) => l !== original && items.length > 0 && items.every((i) => i.text[l] || !i.text[original]?.trim()),
  );
  return [original, ...others];
}

/**
 * Storage key of a cached read-aloud clip. The text hash and speaker id are
 * part of it, so a re-import, a new translation or another voice never replays
 * stale audio.
 */
export function speechCacheKey(prefix: string, speakerId: string, lang: SourceLanguage, kind: SourceReader["kind"], index: number, text: string, ext: string): string {
  const hash = createHash("sha256").update(text).digest("hex").slice(0, 16);
  const safeSpeaker = speakerId.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${prefix}/tts/${safeSpeaker}/${lang}/${kind}-${index}-${hash}.${ext}`;
}
