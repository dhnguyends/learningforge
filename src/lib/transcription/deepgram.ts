import { getEnv } from "@/lib/env";
import type { TranscribeOptions, TranscriptionProvider, TranscriptionResult } from "@/lib/transcription/types";
import { coalesceSegments } from "@/lib/transcription/types";

interface DeepgramResponse {
  metadata?: { duration?: number; model_info?: Record<string, string> };
  results?: {
    channels?: Array<{
      alternatives?: Array<{
        transcript?: string;
        confidence?: number;
        words?: Array<{ word: string; start: number; end: number; speaker?: number; confidence?: number }>;
      }>;
    }>;
    utterances?: Array<{
      start: number;
      end: number;
      transcript: string;
      confidence?: number;
      speaker?: number;
    }>;
  };
}

/** Deepgram Nova managed transcription with native speaker diarization. */
export class DeepgramProvider implements TranscriptionProvider {
  readonly name = "deepgram";
  readonly supportsDiarization = true;

  async transcribe(audio: Buffer, filename: string, opts: TranscribeOptions): Promise<TranscriptionResult> {
    const env = getEnv();
    const params = new URLSearchParams({
      model: "nova-2",
      smart_format: "true",
      punctuate: "true",
      ...(opts.diarize ? { diarize: "true" } : {}),
      ...(opts.language && opts.language !== "en" ? { language: opts.language } : {}),
    });

    const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
      method: "POST",
      headers: {
        Authorization: `Token ${env.DEEPGRAM_API_KEY}`,
        "Content-Type": mimeFor(filename),
      },
      body: new Uint8Array(audio),
    });
    if (!res.ok) throw new Error(`Deepgram error ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json = (await res.json()) as DeepgramResponse;

    const utterances = json.results?.utterances ?? [];
    const segments = utterances.map((u) => ({
      startMs: Math.round(u.start * 1000),
      endMs: Math.round(u.end * 1000),
      speaker: u.speaker != null ? `Speaker ${u.speaker + 1}` : undefined,
      text: u.transcript,
      confidence: u.confidence,
    }));

    return {
      provider: this.name,
      language: opts.language ?? "en",
      segments: coalesceSegments(segments.length ? segments : wordsToSegments(json)),
      metadata: { durationSec: json.metadata?.duration },
    };
  }
}

interface DraftSegment {
  startMs: number;
  endMs: number;
  text: string;
  speaker?: string;
}

function wordsToSegments(json: DeepgramResponse): DraftSegment[] {
  const words = json.results?.channels?.[0]?.alternatives?.[0]?.words ?? [];
  const segments: DraftSegment[] = [];
  let current: { startMs: number; endMs: number; text: string[]; speaker?: string } | null = null;
  const flush = () => {
    if (!current) return;
    segments.push({ startMs: current.startMs, endMs: current.endMs, speaker: current.speaker, text: current.text.join(" ") });
  };
  for (const w of words) {
    const speaker = w.speaker != null ? `Speaker ${w.speaker + 1}` : undefined;
    if (current && current.speaker === speaker) {
      current.endMs = w.end * 1000;
      current.text.push(w.word);
    } else {
      flush();
      current = { startMs: w.start * 1000, endMs: w.end * 1000, text: [w.word], speaker };
    }
  }
  flush();
  return segments;
}

function mimeFor(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    mp3: "audio/mpeg",
    wav: "audio/wav",
    m4a: "audio/mp4",
    mp4: "video/mp4",
    webm: "audio/webm",
    ogg: "audio/ogg",
  };
  return map[ext ?? ""] ?? "audio/mpeg";
}
