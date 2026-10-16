import { getEnv, mockProvidersAllowed } from "@/lib/env";
import type { TranscriptionProvider, TranscriptionResult, TranscribeOptions } from "@/lib/transcription/types";
import { coalesceSegments } from "@/lib/transcription/types";
import { WhisperProvider } from "@/lib/transcription/whisper";
import { DeepgramProvider } from "@/lib/transcription/deepgram";

/**
 * Offline stand-in: synthesizes short, clearly-labeled segments sized to the
 * expected media duration. Used for dev, tests and demos where the point is to
 * exercise the pipeline (chunks → index → citations), not ASR quality.
 */
class MockTranscriber implements TranscriptionProvider {
  readonly name = "mock";
  readonly supportsDiarization = true;

  async transcribe(audio: Buffer, _filename: string, opts: TranscribeOptions): Promise<TranscriptionResult> {
    // Never let placeholder text pass for a real lecture outside tests and demos.
    if (!mockProvidersAllowed()) {
      throw new Error(
        "Transcription is not configured (TRANSCRIPTION_PROVIDER=mock would store placeholder text). " +
          'Set TRANSCRIPTION_PROVIDER="whisper" (e.g. the local Whisper server, see DEVELOPMENT.md) and import this source again, ' +
          "or set ALLOW_MOCK_PROVIDERS=true for an offline demo.",
      );
    }
    const durationSec = opts.expectedDurationSec ?? estimateFromBytes(audio.byteLength) ?? 120;
    const segments = [];
    for (let start = 0; start < durationSec; start += 12) {
      const idx = Math.floor(start / 12) + 1;
      segments.push({
        startMs: start * 1000,
        endMs: Math.min(start + 12, durationSec) * 1000,
        speaker: opts.diarize ? (idx % 2 === 0 ? "Instructor" : "Student") : undefined,
        text: `[mock transcription ${idx}] Lecture audio segment covering minute ${Math.floor(start / 60)} of the recording. Replace with a real transcription provider for production use.`,
        confidence: 0.95,
      });
    }
    return {
      provider: this.name,
      language: opts.language ?? "en",
      segments: coalesceSegments(segments, { maxSec: 12 }),
      metadata: { durationSec, mock: true },
    };
  }
}

function estimateFromBytes(bytes: number): number | undefined {
  if (!bytes) return undefined;
  return Math.max(30, Math.round(bytes / 16000)); // ~128kbps audio heuristic
}

let cached: TranscriptionProvider | null = null;

export function getTranscriber(): TranscriptionProvider {
  if (cached) return cached;
  const env = getEnv();
  switch (env.TRANSCRIPTION_PROVIDER) {
    case "whisper":
      cached = new WhisperProvider();
      break;
    case "deepgram":
      cached = new DeepgramProvider();
      break;
    default:
      cached = new MockTranscriber();
  }
  return cached;
}

export type { TranscriptionProvider, TranscriptionResult, TranscribeOptions } from "@/lib/transcription/types";
