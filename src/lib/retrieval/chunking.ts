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
 * point at pages), long pages split at paragraph boundaries. A paragraph over
 * MAX_TOKENS (PDF pages often arrive as one) is first split into ~TARGET_TOKENS
 * pieces at sentence boundaries, falling back to word boundaries.
 */
export function chunkDocument(doc: ParsedDocument): ChunkDraft[] {
  const chunks: ChunkDraft[] = [];
  for (const page of doc.pages) {
    const paragraphs = page.text
      .split(/\n{2,}|(?<=\.)\s{2,}/)
      .map((p) => p.trim())
      .filter(Boolean)
      .flatMap((p) => (estimateTokens(p) > MAX_TOKENS ? splitOversized(p) : [p]));
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

/**
 * Split an oversized paragraph into pieces of ~TARGET_TOKENS (never more than
 * MAX_TOKENS). Sentences are grouped until the target is reached; a sentence
 * that alone exceeds MAX_TOKENS is cut into word windows. Word counts (not
 * per-unit estimates) are summed so the size matches estimateTokens exactly.
 */
function splitOversized(paragraph: string): string[] {
  const wordsPerWindow = Math.floor(TARGET_TOKENS / 1.35);
  const units = paragraph
    .split(/(?<=[.!?]["')\]]*)\s+/)
    .filter(Boolean)
    .flatMap((sentence) => {
      if (estimateTokens(sentence) <= MAX_TOKENS) return [sentence];
      const words = sentence.split(/\s+/).filter(Boolean);
      const windows: string[] = [];
      for (let i = 0; i < words.length; i += wordsPerWindow) windows.push(words.slice(i, i + wordsPerWindow).join(" "));
      return windows;
    });

  const pieces: string[] = [];
  let buffer: string[] = [];
  let words = 0;
  const tokensFor = (n: number) => Math.ceil(n * 1.35);
  const flush = () => {
    if (buffer.length) pieces.push(buffer.join(" "));
    buffer = [];
    words = 0;
  };
  for (const unit of units) {
    const w = unit.split(/\s+/).filter(Boolean).length;
    if (tokensFor(words + w) > MAX_TOKENS) flush();
    buffer.push(unit);
    words += w;
    if (tokensFor(words) >= TARGET_TOKENS) flush();
  }
  flush();
  return pieces;
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
