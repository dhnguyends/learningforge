import type { ChunkKind } from "@prisma/client";
import type { ParsedDocument } from "@/lib/documents/parse";

export interface ChunkDraft {
  ordinal: number;
  kind: ChunkKind;
  heading?: string;
  content: string;
  page?: number;
  startMs?: number;
  endMs?: number;
  speaker?: string;
  tokenCount: number;
}

export interface TranscriptSegmentInput {
  startMs: number;
  endMs: number;
  speaker?: string | null;
  text: string;
}

const TARGET_TOKENS = 320;
const MAX_TOKENS = 480;
const PAUSE_BREAK_MS = 2500;

export function estimateTokens(text: string): number {
  return Math.ceil(text.split(/\s+/).filter(Boolean).length * 1.35);
}

/**
 * Chunk transcript segments into citation-preserving windows. Breaks happen at
 * speaker changes, long pauses, or sentence boundaries near the token target —
 * never mid-sentence, so every chunk's (start, end) maps to coherent speech.
 */
export function chunkTranscript(segments: TranscriptSegmentInput[]): ChunkDraft[] {
  const chunks: ChunkDraft[] = [];
  let current: { parts: string[]; startMs: number; endMs: number; speaker?: string; tokens: number } | null = null;

  const flush = () => {
    if (!current || current.parts.length === 0) return;
    const content = current.parts.join(" ").replace(/\s+/g, " ").trim();
    if (!content) return;
    chunks.push({
      ordinal: chunks.length,
      kind: "TRANSCRIPT",
      content,
      startMs: current.startMs,
      endMs: current.endMs,
      speaker: current.speaker,
      tokenCount: estimateTokens(content),
    });
    current = null;
  };

  for (const seg of segments) {
    const text = seg.text.trim();
    if (!text) continue;
    const segTokens = estimateTokens(text);
    const speaker = seg.speaker ?? undefined;

    if (current) {
      const pauseBefore = seg.startMs - current.endMs;
      const speakerChange = speaker && current.speaker && speaker !== current.speaker;
      if (current.tokens + segTokens > MAX_TOKENS || pauseBefore > PAUSE_BREAK_MS || speakerChange) flush();
    }

    if (!current) {
      current = { parts: [], startMs: seg.startMs, endMs: seg.endMs, speaker, tokens: 0 };
    }
    current.parts.push(text);
    current.endMs = seg.endMs;
    current.tokens += segTokens;

    // Close at a sentence boundary once we pass the target.
    if (current.tokens >= TARGET_TOKENS && /[.!?]$/.test(text)) flush();
  }
  flush();
  return renumber(chunks);
}

/**
 * Chunk parsed document pages. Page boundaries are always preserved (citations
 * point at pages), long pages split at paragraph boundaries.
 */
export function chunkDocument(doc: ParsedDocument): ChunkDraft[] {
  const chunks: ChunkDraft[] = [];
  for (const page of doc.pages) {
    const paragraphs = page.text.split(/\n{2,}|(?<=\.)\s{2,}/).map((p) => p.trim()).filter(Boolean);
    if (paragraphs.length === 0) continue;
    let buffer: string[] = [];
    let tokens = 0;
    for (const para of paragraphs) {
      const t = estimateTokens(para);
      if (tokens + t > MAX_TOKENS && buffer.length) {
        pushPageChunk(chunks, page, buffer.join("\n\n"), doc.kind);
        buffer = [];
        tokens = 0;
      }
      buffer.push(para);
      tokens += t;
    }
    if (buffer.length) pushPageChunk(chunks, page, buffer.join("\n\n"), doc.kind);
  }
  return renumber(chunks);
}

function pushPageChunk(chunks: ChunkDraft[], page: { page: number; heading?: string }, content: string, kind: ChunkKind) {
  if (!content.trim()) return;
  chunks.push({
    ordinal: chunks.length,
    kind,
    heading: page.heading,
    content,
    page: page.page,
    tokenCount: estimateTokens(content),
  });
}

function renumber(chunks: ChunkDraft[]): ChunkDraft[] {
  return chunks.map((c, i) => ({ ...c, ordinal: i }));
}
