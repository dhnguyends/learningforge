import OpenAI from "openai";
import { getEnv } from "@/lib/env";
import type { TranscribeOptions, TranscriptionProvider, TranscriptionResult } from "@/lib/transcription/types";
import { coalesceSegments } from "@/lib/transcription/types";

interface WhisperVerboseSegment {
  start: number;
  end: number;
  text: string;
  no_speech_prob?: number;
  avg_logprob?: number;
}

interface WhisperVerboseResponse {
  text: string;
  language?: string;
  duration?: number;
  segments?: WhisperVerboseSegment[];
}

/**
 * Any Whisper-compatible /audio/transcriptions endpoint (OpenAI, faster-whisper
 * servers, Groq). Plain Whisper has no diarization: segments are single-speaker
 * and a metadata warning is recorded when diarization was requested.
 */
export class WhisperProvider implements TranscriptionProvider {
  readonly name = "whisper";
  readonly supportsDiarization = false;
  private client: OpenAI;
  private model: string;

  constructor() {
    const env = getEnv();
    this.model = env.WHISPER_MODEL;
    this.client = new OpenAI({
      apiKey: env.WHISPER_API_KEY,
      baseURL: env.WHISPER_BASE_URL,
    });
  }

  async transcribe(audio: Buffer, filename: string, opts: TranscribeOptions): Promise<TranscriptionResult> {
    const res = await this.client.audio.transcriptions.create({
      file: new File([new Uint8Array(audio)], filename, { type: "audio/mpeg" }),
      model: this.model,
      response_format: "verbose_json",
      ...(opts.language ? { language: opts.language } : {}),
      temperature: 0,
    }) as unknown as WhisperVerboseResponse;

    const raw = (res.segments ?? []).map((s) => ({
      startMs: Math.round(s.start * 1000),
      endMs: Math.round(s.end * 1000),
      text: s.text.trim(),
      confidence: s.no_speech_prob != null ? Math.max(0, 1 - s.no_speech_prob) : undefined,
    }));

    return {
      provider: this.name,
      language: res.language ?? opts.language ?? "en",
      segments: coalesceSegments(raw),
      metadata: {
        durationSec: res.duration,
        ...(opts.diarize && this.supportsDiarization === false
          ? { warnings: ["Speaker diarization requested but the Whisper endpoint does not support it."] }
          : {}),
      },
    };
  }
}
