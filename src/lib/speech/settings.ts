import { z } from "zod";
import { prisma } from "@/lib/db";
import { getEnv, type Env } from "@/lib/env";
import type { SourceLanguage } from "@/lib/language";
import { getActiveAi, localModelOptions, localModelProblem, ollamaModelName } from "@/lib/ai/settings";
import { localModelLabel, sameModel } from "@/lib/ai/ollama";

/**
 * Translator and text-to-speech choices made at /admin → AI model, stored in
 * app_settings (keys "translator" and "tts"). Like the generation model: keys
 * stay in .env, a cloud choice without its key falls back to the local option.
 */

// ---------------------------------------------------------------- translator

export const TRANSLATOR_PROVIDERS = {
  local: { label: "Local model (Ollama)", note: "Private and free; slower on long lectures.", cloud: null },
  azure: { label: "Azure AI Translator — cloud", note: "Fast and consistent; about $10 per 1M characters, free tier available.", cloud: "Microsoft Azure" },
} as const;
export type TranslatorProvider = keyof typeof TRANSLATOR_PROVIDERS;

/**
 * "local" translates with an installed Ollama model (`model`; the AI model's
 * when it is local, else LOCAL_AI_MODEL, when absent). One language model on
 * the GPU: while the AI model is local, a local translator uses that same
 * model — any other would unload it at every translation.
 */
export const translatorChoiceSchema = z.object({ provider: z.enum(["local", "azure"]), model: ollamaModelName.optional() });
export type TranslatorChoice = z.infer<typeof translatorChoiceSchema>;

/** The AI model's local model, when the AI model is local (null for a cloud model). */
export async function aiLocalModel(): Promise<string | null> {
  const ai = await getActiveAi();
  return ai.provider === "local" ? ai.model : null;
}

/**
 * Why a translator choice cannot be used (a local model other than the local
 * AI model, not installed, Ollama down), or null. `model` is the local model
 * it resolves to.
 */
export async function translatorChoiceProblem(choice: TranslatorChoice, env: Env = getEnv()): Promise<{ problem: string | null; model: string | null }> {
  if (choice.provider === "azure") {
    return { problem: translatorConfigured("azure", env) ? null : "Set AZURE_TRANSLATOR_KEY in the server environment before selecting Azure AI Translator", model: null };
  }
  const ai = await aiLocalModel();
  const model = choice.model ?? ai ?? env.LOCAL_AI_MODEL;
  if (ai && !sameModel(model, ai)) {
    return {
      problem: `The AI model is ${localModelLabel(ai)} (${ai}): a local translator must use the same model, or the GPU would unload one for the other. Choose ${localModelLabel(ai)} or Azure AI Translator.`,
      model,
    };
  }
  return { problem: await localModelProblem(model, env), model };
}

export function translatorConfigured(provider: TranslatorProvider, env: Env = getEnv()): boolean {
  return provider === "local" || Boolean(env.AZURE_TRANSLATOR_KEY?.trim());
}

// ---------------------------------------------------------------------- TTS

type VoiceList = Record<SourceLanguage, readonly string[]>;

export const TTS_PROVIDERS = {
  kokoro: {
    label: "Kokoro-82M — local",
    note: "Most natural local English voices; one French voice. Runs on the Speaches server.",
    cloud: null,
    voices: { en: ["af_heart", "af_bella", "am_michael", "bf_emma", "bm_george"], fr: ["ff_siwis"] } as VoiceList,
    defaults: { en: "af_heart", fr: "ff_siwis" },
  },
  piper: {
    label: "Piper — local",
    note: "Fastest local option, several French voices. Runs on the Speaches server.",
    cloud: null,
    voices: { en: ["lessac", "amy", "ryan"], fr: ["siwis", "tom", "upmc", "gilles"] } as VoiceList,
    defaults: { en: "lessac", fr: "siwis" },
  },
  azure: {
    label: "Azure Neural TTS — cloud",
    note: "Studio-quality French and English; $15 per 1M characters, 0.5M free per month.",
    cloud: "Microsoft Azure",
    voices: {
      en: ["en-US-JennyNeural", "en-US-GuyNeural", "en-GB-SoniaNeural"],
      fr: ["fr-FR-DeniseNeural", "fr-FR-HenriNeural", "fr-FR-VivienneMultilingualNeural"],
    } as VoiceList,
    defaults: { en: "en-US-JennyNeural", fr: "fr-FR-DeniseNeural" },
  },
  gemini: {
    label: "Gemini 3.8 Flash-Lite TTS — cloud",
    note: "Expressive, 100+ languages; about $0.54 per hour of speech.",
    cloud: "Google",
    voices: { en: ["Kore", "Puck", "Charon", "Aoede", "Fenrir"], fr: ["Kore", "Puck", "Charon", "Aoede", "Fenrir"] } as VoiceList,
    defaults: { en: "Kore", fr: "Kore" },
  },
} as const;
export type TtsProvider = keyof typeof TTS_PROVIDERS;

/** Piper has one model per voice (Speaches model ids). */
export const PIPER_MODELS: Record<string, string> = {
  lessac: "speaches-ai/piper-en_US-lessac-medium",
  amy: "speaches-ai/piper-en_US-amy-medium",
  ryan: "speaches-ai/piper-en_US-ryan-medium",
  siwis: "speaches-ai/piper-fr_FR-siwis-medium",
  tom: "speaches-ai/piper-fr_FR-tom-medium",
  upmc: "speaches-ai/piper-fr_FR-upmc-medium",
  gilles: "speaches-ai/piper-fr_FR-gilles-low",
};
export const KOKORO_MODEL = "speaches-ai/Kokoro-82M-v1.0-ONNX-fp16";

export const ttsChoiceSchema = z
  .object({
    provider: z.enum(["kokoro", "piper", "azure", "gemini"]),
    voices: z.object({ en: z.string().min(1), fr: z.string().min(1) }),
  })
  .refine((c) => (["en", "fr"] as const).every((l) => TTS_PROVIDERS[c.provider].voices[l].includes(c.voices[l])), {
    message: "Unknown voice for this model",
  });
export type TtsChoice = z.infer<typeof ttsChoiceSchema>;

export function ttsConfigured(provider: TtsProvider, env: Env = getEnv()): boolean {
  if (provider === "azure") return Boolean(env.AZURE_SPEECH_KEY?.trim());
  if (provider === "gemini") return Boolean(env.GEMINI_API_KEY?.trim());
  return true;
}

// ------------------------------------------------------------------ storage

const TTL_MS = 30_000;
const memo = new Map<string, { value: unknown; at: number }>();

async function readSetting<T>(key: string, schema: z.ZodType<T>): Promise<T | null> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T | null;
  const row = await prisma.appSetting.findUnique({ where: { key } });
  const parsed = row ? schema.safeParse(row.value) : null;
  const value = parsed?.success ? parsed.data : null;
  memo.set(key, { value, at: Date.now() });
  return value;
}

async function writeSetting(key: string, value: object, userId: string): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value, updatedById: userId },
    update: { value, updatedById: userId },
  });
  memo.set(key, { value, at: Date.now() });
}

export const saveTranslatorChoice = (c: TranslatorChoice, userId: string) => writeSetting("translator", c, userId);

/** Drops the in-process memo (tests, and after a restore). */
export function invalidateSpeechSettings(): void {
  memo.clear();
}
export const saveTtsChoice = (c: TtsChoice, userId: string) => writeSetting("tts", c, userId);

export const getStoredTranslatorChoice = () => readSetting("translator", translatorChoiceSchema);

/**
 * Active translator: the admin's choice when usable, otherwise local. A local
 * translator runs the AI model's local model when the AI model is local (one
 * model on the GPU), else its stored model, else LOCAL_AI_MODEL.
 */
export async function getActiveTranslator(): Promise<{ provider: TranslatorProvider; model: string | null; source: "admin" | "default" | "fallback" }> {
  const stored = await getStoredTranslatorChoice();
  const local = async () => (await aiLocalModel()) ?? stored?.model ?? getEnv().LOCAL_AI_MODEL;
  if (!stored) return { provider: "local", model: await local(), source: "default" };
  if (!translatorConfigured(stored.provider)) return { provider: "local", model: await local(), source: "fallback" };
  return { provider: stored.provider, model: stored.provider === "local" ? await local() : null, source: "admin" };
}

/**
 * After the AI model moved to local model `model`: a stored local translator
 * on another model follows it (one model on the GPU). Returns the change, or
 * null when nothing had to change.
 */
export async function translatorFollowsAiModel(model: string, userId: string): Promise<{ from: string; to: string } | null> {
  const stored = await getStoredTranslatorChoice();
  if (!stored || stored.provider !== "local") return null;
  const from = stored.model ?? getEnv().LOCAL_AI_MODEL;
  if (sameModel(from, model)) return null;
  await saveTranslatorChoice({ provider: "local", model }, userId);
  return { from, to: model };
}

/** Active read-aloud model and voices: the admin's choice when usable, otherwise Kokoro. */
export async function getActiveTts(): Promise<TtsChoice & { source: "admin" | "default" | "fallback" }> {
  const stored = await readSetting("tts", ttsChoiceSchema);
  const fallback = { provider: "kokoro" as const, voices: { ...TTS_PROVIDERS.kokoro.defaults } };
  if (!stored) return { ...fallback, source: "default" };
  if (!ttsConfigured(stored.provider)) return { ...fallback, source: "fallback" };
  return { ...stored, source: "admin" };
}

/** What /admin shows. Never any key. */
export async function speechSettingsView() {
  const env = getEnv();
  const [translator, tts, ai, locals] = await Promise.all([getActiveTranslator(), getActiveTts(), aiLocalModel(), localModelOptions(env)]);
  const localNote = (name: string) =>
    /deepseek-r1/i.test(name)
      ? "Private and free; reasons before translating, so much slower."
      : TRANSLATOR_PROVIDERS.local.note;
  return {
    translator: {
      active: translator,
      /** The AI model's local model: the only local model a translator may use (null: the AI model is in the cloud). */
      aiLocalModel: ai,
      options: [
        // One option per local chat model installed in Ollama (Gemma 4, DeepSeek-R1…).
        ...locals.map((m) => ({
          id: `local:${m.name}`,
          provider: "local" as TranslatorProvider,
          model: m.name as string | null,
          label: `${m.label} — local (Ollama)`,
          note: localNote(m.name),
          cloud: null as string | null,
          configured: m.installed,
          missingKey: m.installed ? null : "a running Ollama",
          blockedBy:
            ai && !sameModel(m.name, ai)
              ? `The AI model is ${localModelLabel(ai)}: a local translator must use the same model (one model on the GPU).`
              : null,
        })),
        {
          id: "azure",
          provider: "azure" as TranslatorProvider,
          model: null as string | null,
          label: TRANSLATOR_PROVIDERS.azure.label,
          note: TRANSLATOR_PROVIDERS.azure.note,
          cloud: TRANSLATOR_PROVIDERS.azure.cloud as string | null,
          configured: translatorConfigured("azure", env),
          missingKey: "AZURE_TRANSLATOR_KEY" as string | null,
          blockedBy: null as string | null,
        },
      ],
    },
    tts: {
      active: tts,
      options: (Object.keys(TTS_PROVIDERS) as TtsProvider[]).map((id) => ({
        id,
        label: TTS_PROVIDERS[id].label,
        note: TTS_PROVIDERS[id].note,
        cloud: TTS_PROVIDERS[id].cloud,
        voices: TTS_PROVIDERS[id].voices,
        defaults: TTS_PROVIDERS[id].defaults,
        configured: ttsConfigured(id, env),
        missingKey: id === "azure" ? "AZURE_SPEECH_KEY" : id === "gemini" ? "GEMINI_API_KEY" : null,
      })),
    },
  };
}
export type SpeechSettingsView = Awaited<ReturnType<typeof speechSettingsView>>;

/**
 * PolyLingue voices chosen by an admin, per target language: "kokoro:<voice>"
 * or "piper:<model>" (local voices only). A language without a choice uses the
 * read-aloud model as before.
 */
const polylingueVoicesSchema = z.record(z.string().min(2).max(12), z.string().min(3).max(120));
export type PolylingueVoices = z.infer<typeof polylingueVoicesSchema>;
export const readPolylingueVoices = async (): Promise<PolylingueVoices> => (await readSetting("polylingue_voices", polylingueVoicesSchema)) ?? {};
export const savePolylingueVoices = (v: PolylingueVoices, userId: string) => writeSetting("polylingue_voices", v, userId);
