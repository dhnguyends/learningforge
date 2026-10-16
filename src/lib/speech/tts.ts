import { getEnv, mockProvidersAllowed } from "@/lib/env";
import { cpuTimeoutFactor } from "@/lib/gpu";
import type { SourceLanguage } from "@/lib/language";
import { KOKORO_MODEL, PIPER_MODELS, getActiveTts, type TtsChoice } from "@/lib/speech/settings";

/** Read-aloud of source text in French or English with the model chosen at /admin. */
export interface SpeechAudio {
  audio: Buffer;
  contentType: string;
  ext: "mp3" | "wav";
}

export interface Speaker {
  /** Provider + voice — part of the cache key, so changing it never replays old audio. */
  readonly id: string;
  /** Audio format this speaker returns (known before synthesis, for cache keys). */
  readonly ext: SpeechAudio["ext"];
  readonly contentType: string;
  synthesize(text: string, lang: SourceLanguage): Promise<SpeechAudio>;
}

const AZURE_LOCALES: Record<SourceLanguage, string> = { fr: "fr-FR", en: "en-US" };

/** Kokoro and Piper through the local Speaches server (OpenAI-compatible /audio/speech). */
class SpeachesSpeaker implements Speaker {
  readonly id: string;
  readonly ext = "mp3" as const;
  readonly contentType = "audio/mpeg";
  constructor(private choice: TtsChoice) {
    this.id = `${choice.provider}-${choice.voices.en}-${choice.voices.fr}`;
  }

  private target(lang: SourceLanguage): { model: string; voice: string } {
    const voice = this.choice.voices[lang];
    if (this.choice.provider === "piper") return { model: PIPER_MODELS[voice], voice };
    return { model: KOKORO_MODEL, voice };
  }

  async synthesize(text: string, lang: SourceLanguage): Promise<SpeechAudio> {
    const base = getEnv().SPEACHES_BASE_URL.replace(/\/$/, "");
    const { model, voice } = this.target(lang);
    const timeout = 120_000 * (await cpuTimeoutFactor());
    const request = () =>
      fetch(`${base}/audio/speech`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, voice, input: text, response_format: "mp3" }),
        signal: AbortSignal.timeout(timeout),
      });
    let res: Response;
    try {
      res = await request();
      if (res.status === 404) {
        // Voice not downloaded yet: Speaches installs models on request.
        const install = await fetch(`${base}/models/${model}`, { method: "POST", signal: AbortSignal.timeout(600_000) });
        if (install.ok) res = await request();
      }
    } catch (err) {
      throw new Error(`Speech server unreachable at ${base} — is the Speaches container running? (${err instanceof Error ? err.message : err})`);
    }
    if (!res.ok) throw new Error(`Speech synthesis (${model}) failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    return { audio: Buffer.from(await res.arrayBuffer()), contentType: "audio/mpeg", ext: "mp3" };
  }
}

/** Azure Neural TTS (REST, SSML). */
class AzureSpeaker implements Speaker {
  readonly id: string;
  readonly ext = "mp3" as const;
  readonly contentType = "audio/mpeg";
  constructor(private choice: TtsChoice) {
    this.id = `azure-${choice.voices.en}-${choice.voices.fr}`;
  }

  async synthesize(text: string, lang: SourceLanguage): Promise<SpeechAudio> {
    const env = getEnv();
    const key = env.AZURE_SPEECH_KEY?.trim();
    if (!key) throw new Error("Azure TTS is selected but AZURE_SPEECH_KEY is not set");
    const ssml =
      `<speak version="1.0" xml:lang="${AZURE_LOCALES[lang]}"><voice name="${this.choice.voices[lang]}">` +
      `${escapeXml(text)}</voice></speak>`;
    const res = await fetch(`https://${env.AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
        "User-Agent": "LearningForge",
      },
      body: ssml,
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`Azure TTS error ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return { audio: Buffer.from(await res.arrayBuffer()), contentType: "audio/mpeg", ext: "mp3" };
  }
}

/** Gemini TTS (generateContent with an AUDIO response: 24 kHz 16-bit mono PCM), wrapped as WAV. */
class GeminiSpeaker implements Speaker {
  readonly id: string;
  readonly ext = "wav" as const;
  readonly contentType = "audio/wav";
  constructor(private choice: TtsChoice) {
    this.id = `gemini-${choice.voices.en}-${choice.voices.fr}`;
  }

  async synthesize(text: string, lang: SourceLanguage): Promise<SpeechAudio> {
    const env = getEnv();
    const key = env.GEMINI_API_KEY?.trim();
    if (!key) throw new Error("Gemini TTS is selected but GEMINI_API_KEY is not set");
    const res = await fetch(`${env.GEMINI_BASE_URL.replace(/\/$/, "")}/models/${encodeURIComponent(env.GEMINI_TTS_MODEL)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: this.choice.voices[lang] } } },
        },
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      const body = await res.text();
      let message = body;
      try {
        message = (JSON.parse(body) as { error?: { message?: string } }).error?.message ?? body;
      } catch {
        /* raw body */
      }
      throw new Error(`Gemini TTS error ${res.status}: ${message.slice(0, 200)}`);
    }
    const json = (await res.json()) as { candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } }[] };
    const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    if (!part?.inlineData?.data) throw new Error("Gemini TTS returned no audio");
    const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType ?? "")?.[1] ?? 24_000);
    return { audio: pcmToWav(Buffer.from(part.inlineData.data, "base64"), rate), contentType: "audio/wav", ext: "wav" };
  }
}

/** Tests and offline demos: a short silent WAV. */
class MockSpeaker implements Speaker {
  readonly id = "mock";
  readonly ext = "wav" as const;
  readonly contentType = "audio/wav";
  async synthesize(): Promise<SpeechAudio> {
    return { audio: pcmToWav(Buffer.alloc(4_800), 24_000), contentType: "audio/wav", ext: "wav" };
  }
}

export function pcmToWav(pcm: Buffer, sampleRate: number, channels = 1, bitsPerSample = 16): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE((channels * bitsPerSample) / 8, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function escapeXml(text: string): string {
  return text.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c] as string);
}

export function speakerFor(choice: TtsChoice): Speaker {
  switch (choice.provider) {
    case "azure":
      return new AzureSpeaker(choice);
    case "gemini":
      return new GeminiSpeaker(choice);
    default:
      return new SpeachesSpeaker(choice);
  }
}

/** The read-aloud model chosen at /admin (silent mock in tests and offline demos). */
export async function getSpeaker(): Promise<Speaker> {
  if (getEnv().AI_PROVIDER === "mock" && mockProvidersAllowed()) return new MockSpeaker();
  return speakerFor(await getActiveTts());
}
