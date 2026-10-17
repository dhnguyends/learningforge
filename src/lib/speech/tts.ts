import { getEnv, mockProvidersAllowed } from "@/lib/env";
import { cpuTimeoutFactor } from "@/lib/gpu";
import { KOKORO_MODEL, PIPER_MODELS, getActiveTts, ttsConfigured, type TtsChoice } from "@/lib/speech/settings";
import { GEMINI_TTS_LANGUAGES, KOKORO_VOICES, PIPER_LANGUAGE_MODELS, baseLanguage, piperVoiceName } from "@/lib/speech/languages";

/**
 * Read-aloud of source text in any language: the model chosen at /admin when
 * it speaks the language, otherwise a local voice (Kokoro / Piper on the
 * Speaches server), otherwise a configured cloud voice (Azure, Gemini).
 */
export interface SpeechAudio {
  audio: Buffer;
  contentType: string;
  ext: "mp3" | "wav";
}

/** One voice in one language. */
export interface Speaker {
  /** Engine + model + voice — part of the cache key, so another voice never replays old audio. */
  readonly id: string;
  /** Shown to the user, e.g. "Kokoro · ef_dora". */
  readonly label: string;
  /** Audio format this speaker returns (known before synthesis, for cache keys). */
  readonly ext: SpeechAudio["ext"];
  readonly contentType: string;
  synthesize(text: string): Promise<SpeechAudio>;
}

type Engine = "kokoro" | "piper" | "azure" | "gemini";
export interface Voice {
  engine: Engine;
  voice: string;
  /** Speaches model id (Kokoro / Piper) or Azure locale. */
  model?: string;
}

/** Kokoro and Piper through the local Speaches server (OpenAI-compatible /audio/speech). */
class SpeachesSpeaker implements Speaker {
  readonly id: string;
  readonly label: string;
  readonly ext = "mp3" as const;
  readonly contentType = "audio/mpeg";
  constructor(private v: Voice & { model: string }) {
    this.id = `${v.engine}-${v.model.replace(/^speaches-ai\//, "")}-${v.voice}`;
    this.label = `${v.engine === "kokoro" ? "Kokoro" : "Piper"} · ${v.voice}`;
  }

  async synthesize(text: string): Promise<SpeechAudio> {
    const base = getEnv().SPEACHES_BASE_URL.replace(/\/$/, "");
    const { model, voice } = this.v;
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
  readonly label: string;
  readonly ext = "mp3" as const;
  readonly contentType = "audio/mpeg";
  constructor(private v: Voice & { model: string }) {
    this.id = `azure-${v.voice}`;
    this.label = `Azure · ${v.voice}`;
  }

  async synthesize(text: string): Promise<SpeechAudio> {
    const env = getEnv();
    const key = env.AZURE_SPEECH_KEY?.trim();
    if (!key) throw new Error("Azure TTS is selected but AZURE_SPEECH_KEY is not set");
    const ssml =
      `<speak version="1.0" xml:lang="${escapeXml(this.v.model)}"><voice name="${escapeXml(this.v.voice)}">` +
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
  readonly label: string;
  readonly ext = "wav" as const;
  readonly contentType = "audio/wav";
  constructor(private v: Voice) {
    this.id = `gemini-${v.voice}`;
    this.label = `Gemini · ${v.voice}`;
  }

  async synthesize(text: string): Promise<SpeechAudio> {
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
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: this.v.voice } } },
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
  readonly label = "Mock (silent)";
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

// ------------------------------------------------------------- voice choice

const DAY_MS = 24 * 60 * 60 * 1000;
let azureVoices: { at: number; region: string; list: { ShortName: string; Locale: string }[] } | null = null;

/** Azure's neural voices for the configured region (needs the key), cached for a day. */
async function azureVoiceList(): Promise<{ ShortName: string; Locale: string }[]> {
  const env = getEnv();
  if (azureVoices && azureVoices.region === env.AZURE_SPEECH_REGION && Date.now() - azureVoices.at < DAY_MS) return azureVoices.list;
  const res = await fetch(`https://${env.AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/voices/list`, {
    headers: { "Ocp-Apim-Subscription-Key": env.AZURE_SPEECH_KEY?.trim() ?? "" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Azure voices: ${res.status}`);
  const list = ((await res.json()) as { ShortName: string; Locale: string; VoiceType?: string }[]).filter((v) => v.VoiceType !== "Standard");
  azureVoices = { at: Date.now(), region: env.AZURE_SPEECH_REGION, list };
  return list;
}

/** Azure locales wanted for a translation code: "zh-Hans" → zh-CN, "zh-Hant" → zh-TW, "de" → de-DE first. */
export function azureLocaleCandidates(lang: string): string[] {
  const l = lang.toLowerCase();
  if (l === "zh-hans") return ["zh-cn"];
  if (l === "zh-hant") return ["zh-tw", "zh-hk"];
  const base = baseLanguage(l);
  if (l.includes("-")) return [l, base];
  return [`${base}-${base}`, base];
}

async function azureVoiceFor(lang: string): Promise<Voice | null> {
  let list: { ShortName: string; Locale: string }[];
  try {
    list = await azureVoiceList();
  } catch {
    return null;
  }
  // Plain neural voices ("ko-KR-SunHiNeural") before HD / Dragon ones, which cost more.
  const plain = (v: { ShortName: string }) => /^[a-z]{2,3}-[A-Za-z]{2,4}(-[A-Za-z]+)?-[A-Za-z]+Neural$/.test(v.ShortName);
  const ranked = [...list.filter(plain), ...list.filter((v) => !plain(v))];
  for (const want of azureLocaleCandidates(lang)) {
    const hit =
      ranked.find((v) => v.Locale.toLowerCase() === want) ?? ranked.find((v) => v.Locale.toLowerCase().startsWith(`${want}-`));
    if (hit) return { engine: "azure", voice: hit.ShortName, model: hit.Locale };
  }
  return null;
}

function kokoroVoice(choice: TtsChoice, base: string): Voice | null {
  let voice: string | undefined;
  if (base === "en" || base === "fr") voice = choice.provider === "kokoro" ? choice.voices[base] : base === "en" ? "af_heart" : "ff_siwis";
  else voice = KOKORO_VOICES[base];
  return voice ? { engine: "kokoro", voice, model: KOKORO_MODEL } : null;
}

function piperVoice(choice: TtsChoice, base: string): Voice | null {
  if ((base === "en" || base === "fr") && choice.provider === "piper") {
    const voice = choice.voices[base];
    return { engine: "piper", voice, model: PIPER_MODELS[voice] };
  }
  const model = PIPER_LANGUAGE_MODELS[base];
  return model ? { engine: "piper", voice: piperVoiceName(model), model: `speaches-ai/piper-${model}` } : null;
}

/** The voice that reads `lang` aloud: the admin's model when it speaks it, else local, else another cloud model. */
export async function resolveVoice(lang: string, choice: TtsChoice): Promise<Voice | null> {
  const base = baseLanguage(lang);
  const env = getEnv();

  const azure = async (): Promise<Voice | null> => {
    if (!ttsConfigured("azure", env)) return null;
    if (choice.provider === "azure" && (base === "en" || base === "fr")) {
      return { engine: "azure", voice: choice.voices[base], model: base === "fr" ? "fr-FR" : "en-US" };
    }
    return azureVoiceFor(lang);
  };
  const gemini = (): Voice | null => {
    if (!ttsConfigured("gemini", env) || !GEMINI_TTS_LANGUAGES.includes(base)) return null;
    return { engine: "gemini", voice: choice.provider === "gemini" ? choice.voices.en : "Kore" };
  };
  const local = () =>
    choice.provider === "piper" ? (piperVoice(choice, base) ?? kokoroVoice(choice, base)) : (kokoroVoice(choice, base) ?? piperVoice(choice, base));

  if (choice.provider === "azure") return (await azure()) ?? local() ?? gemini();
  if (choice.provider === "gemini") return gemini() ?? local() ?? (await azure());
  return local() ?? (await azure()) ?? gemini();
}

/** A speaker for one given voice (PolyLingue's per-language choice). */
export function speakerForVoice(v: Voice): Speaker {
  if (getEnv().AI_PROVIDER === "mock" && mockProvidersAllowed()) return new MockSpeaker();
  return speakerOf(v);
}

function speakerOf(v: Voice): Speaker {
  if (v.engine === "azure") return new AzureSpeaker(v as Voice & { model: string });
  if (v.engine === "gemini") return new GeminiSpeaker(v);
  return new SpeachesSpeaker(v as Voice & { model: string });
}

/** Speaker for one language with the given (or active) TTS choice; null when no engine speaks it. */
export async function speakerForLanguage(lang: string, choice?: TtsChoice): Promise<Speaker | null> {
  if (getEnv().AI_PROVIDER === "mock" && mockProvidersAllowed()) return new MockSpeaker();
  const voice = await resolveVoice(lang, choice ?? (await getActiveTts()));
  return voice ? speakerOf(voice) : null;
}

/** Which languages can be read aloud, and by which voice (for the reader's Read aloud button). */
export async function voicesForLanguages(langs: string[]): Promise<Record<string, string | null>> {
  const choice = await getActiveTts();
  const out: Record<string, string | null> = {};
  for (const lang of langs) out[lang] = (await speakerForLanguage(lang, choice))?.label ?? null;
  return out;
}
