import { z } from "zod";
import type { CitationAnchor, ExtractedChunk, Source, SourceType } from "@prisma/client";
import { formatTimestamp } from "@/lib/utils";

/** The wire format for a citation anchor (spec-defined). */
export const citationAnchorSchema = z.object({
  anchorId: z.string().optional(),
  sourceId: z.string(),
  sourceType: z.enum(["video", "audio", "pdf", "slide", "note", "image"]),
  start: z.string().optional(), // "00:12:41.000" for A/V sources
  end: z.string().optional(),
  page: z.number().int().optional(),
  chunkId: z.string().optional(),
  excerpt: z.string(),
});

export type CitationAnchorJson = z.infer<typeof citationAnchorSchema>;

const PRISMA_TO_WIRE: Record<SourceType, CitationAnchorJson["sourceType"]> = {
  VIDEO: "video",
  AUDIO: "audio",
  YOUTUBE: "video",
  PDF: "pdf",
  SLIDES: "slide",
  NOTE: "note",
  IMAGE: "image",
};

/** Serialize a DB anchor (+source) into the public citation JSON format. */
export function anchorToJson(
  anchor: CitationAnchor,
  source?: Pick<Source, "id" | "type">,
): CitationAnchorJson {
  return {
    anchorId: anchor.id,
    sourceId: anchor.sourceId,
    sourceType: PRISMA_TO_WIRE[source?.type ?? anchor.sourceType],
    ...(anchor.startMs != null ? { start: formatTimestamp(anchor.startMs, true, true) } : {}),
    ...(anchor.endMs != null ? { end: formatTimestamp(anchor.endMs, true, true) } : {}),
    ...(anchor.page != null ? { page: anchor.page } : {}),
    ...(anchor.chunkId ? { chunkId: anchor.chunkId } : {}),
    excerpt: anchor.excerpt,
  };
}

/** Human label: "12:41–13:18 · Lecture video" or "p. 12 · Slides". */
export function anchorLabel(
  anchor: Pick<CitationAnchor, "startMs" | "endMs" | "page" | "sourceType">,
  sourceTitle?: string,
): string {
  const sourcePart = sourceTitle ?? labelForType(anchor.sourceType);
  if (anchor.startMs != null) {
    const end = anchor.endMs != null ? `–${formatTimestamp(anchor.endMs)}` : "";
    return `${formatTimestamp(anchor.startMs)}${end} · ${sourcePart}`;
  }
  if (anchor.page != null) return `p. ${anchor.page} · ${sourcePart}`;
  return sourcePart;
}

function labelForType(type: SourceType): string {
  const map: Record<SourceType, string> = {
    VIDEO: "Video",
    AUDIO: "Audio",
    YOUTUBE: "Video",
    PDF: "PDF",
    SLIDES: "Slides",
    NOTE: "Notes",
    IMAGE: "Image",
  };
  return map[type];
}

/** Excerpt for verification: trimmed, sentence-safe cut. */
export function makeExcerpt(text: string, maxLen = 180): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen - 1).replace(/\s+\S*$/, "")}…`;
}

export interface ChunkLike {
  id: string;
  sourceId: string;
  sourceType: SourceType;
  content: string;
  page?: number | null;
  startMs?: number | null;
  endMs?: number | null;
}

/** Build anchor input data from a chunk. */
export function anchorDataFromChunk(chunk: ChunkLike) {
  return {
    sourceId: chunk.sourceId,
    sourceType: chunk.sourceType,
    ...(chunk.startMs != null ? { startMs: chunk.startMs } : {}),
    ...(chunk.endMs != null ? { endMs: chunk.endMs } : {}),
    ...(chunk.page != null ? { page: chunk.page } : {}),
    excerpt: makeExcerpt(chunk.content),
  };
}

export type { CitationAnchor, ExtractedChunk };
