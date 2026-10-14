export interface TranscribeOptions {
  language?: string;
  diarize?: boolean;
  /** Hint for mock provider & duration sanity checks (seconds). */
  expectedDurationSec?: number;
}

export interface TranscriptSegmentDraft {
  startMs: number;
  endMs: number;
  speaker?: string;
  text: string;
  confidence?: number;
}

export interface TranscriptionResult {
  provider: string;
  language: string;
  segments: TranscriptSegmentDraft[];
  metadata: Record<string, unknown>;
}

export interface TranscriptionProvider {
  readonly name: string;
  supportsDiarization: boolean;
  /** audio: raw bytes of an audio/video file (mono 16k wav recommended upstream). */
  transcribe(audio: Buffer, filename: string, opts: TranscribeOptions): Promise<TranscriptionResult>;
}

/** Merge adjacent draft segments into target-sized windows (~12s / 45 words). */
export function coalesceSegments(
  segments: TranscriptSegmentDraft[],
  { maxSec = 14, maxWords = 50 } = {},
): TranscriptSegmentDraft[] {
  const out: TranscriptSegmentDraft[] = [];
  let current: TranscriptSegmentDraft | null = null;
  for (const seg of segments) {
    if (seg.text.trim() === "") continue;
    if (
      current &&
      seg.endMs - current.startMs <= maxSec * 1000 &&
      wordCount(current.text) + wordCount(seg.text) <= maxWords &&
      (current.speaker ?? "SPEAKER_00") === (seg.speaker ?? "SPEAKER_00")
    ) {
      current.endMs = seg.endMs;
      current.text = `${current.text} ${seg.text}`.trim();
    } else {
      current = { ...seg, text: seg.text.trim() };
      out.push(current);
    }
  }
  return out;
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}
