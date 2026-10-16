import { getEnv } from "@/lib/env";

/**
 * Languages a source can be translated into for reading and read-aloud (the
 * "reading translations": never vectorized, see pipelines/translate.ts), and
 * the voice each text-to-speech engine uses for them.
 *
 * Codes are the Azure Translator codes (BCP-47 style: "es", "pt", "zh-Hans").
 */
export interface LanguageOption {
  code: string;
  name: string;
}

/** What local Gemma 4 translates well (a curated list; Azure's comes from its API). */
export const LOCAL_TRANSLATION_LANGUAGES: readonly string[] = [
  "ar", "bg", "cs", "da", "de", "el", "en", "es", "fa", "fi", "fr", "he", "hi", "hu", "id", "it", "ja", "ko",
  "ms", "nb", "nl", "pl", "pt", "ro", "ru", "sk", "sv", "sw", "th", "tr", "uk", "ur", "vi", "zh-Hans", "zh-Hant",
];

const NAMES = new Intl.DisplayNames(["en"], { type: "language" });

/** English name of a language code ("zh-Hans" → "Chinese (Simplified)"). */
export function languageName(code: string): string {
  try {
    return NAMES.of(code) ?? code;
  } catch {
    return code;
  }
}

/** Primary subtag, lower case: "zh-Hans" → "zh", "pt-PT" → "pt". */
export function baseLanguage(code: string): string {
  return code.toLowerCase().split(/[-_]/)[0];
}

/** Same language for reading purposes ("fr" ≈ "fr-FR", "zh-Hans" ≠ "zh-Hant" only by script). */
export function sameLanguage(a: string | null | undefined, b: string | null | undefined): boolean {
  return Boolean(a && b) && (a as string).toLowerCase() === (b as string).toLowerCase();
}

const DAY_MS = 24 * 60 * 60 * 1000;
let azureLanguages: { at: number; list: LanguageOption[] } | null = null;

/** Azure Translator's translation languages (public endpoint, no key), cached for a day. */
async function fetchAzureLanguages(): Promise<LanguageOption[]> {
  if (azureLanguages && Date.now() - azureLanguages.at < DAY_MS) return azureLanguages.list;
  const base = getEnv().AZURE_TRANSLATOR_ENDPOINT.replace(/\/$/, "");
  const res = await fetch(`${base}/languages?api-version=3.0&scope=translation`, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Azure languages: ${res.status}`);
  const json = (await res.json()) as { translation?: Record<string, { name: string }> };
  const list = Object.entries(json.translation ?? {}).map(([code, v]) => ({ code, name: v.name }));
  azureLanguages = { at: Date.now(), list };
  return list;
}

/** Target languages the given translator offers, sorted by name. */
export async function translationLanguages(provider: "local" | "azure" | "mock"): Promise<LanguageOption[]> {
  let list: LanguageOption[] = LOCAL_TRANSLATION_LANGUAGES.map((code) => ({ code, name: languageName(code) }));
  if (provider === "azure") {
    try {
      list = await fetchAzureLanguages();
    } catch {
      /* offline: keep the curated list, which Azure supports too */
    }
  }
  return list.sort((a, b) => a.name.localeCompare(b.name));
}

// ------------------------------------------------------------------ voices

/** Kokoro-82M voices per language (one per language; English and French come from the admin choice). */
export const KOKORO_VOICES: Record<string, string> = {
  es: "ef_dora",
  it: "if_sara",
  pt: "pf_dora",
  hi: "hf_alpha",
  ja: "jf_alpha",
  zh: "zf_xiaobei",
};

/** Piper models (Speaches ids, without the "speaches-ai/piper-" prefix) per language. */
export const PIPER_LANGUAGE_MODELS: Record<string, string> = {
  ar: "ar_JO-kareem-medium",
  ca: "ca_ES-upc_ona-medium",
  cs: "cs_CZ-jirka-medium",
  cy: "cy_GB-gwryw_gogleddol-medium",
  da: "da_DK-talesyntese-medium",
  de: "de_DE-thorsten-medium",
  el: "el_GR-rapunzelina-low",
  en: "en_US-lessac-medium",
  es: "es_ES-davefx-medium",
  fa: "fa_IR-amir-medium",
  fi: "fi_FI-harri-medium",
  fr: "fr_FR-siwis-medium",
  hu: "hu_HU-anna-medium",
  id: "id_ID-news_tts-medium",
  is: "is_IS-bui-medium",
  it: "it_IT-paola-medium",
  ka: "ka_GE-natia-medium",
  kk: "kk_KZ-issai-high",
  lb: "lb_LU-marylux-medium",
  lv: "lv_LV-aivars-medium",
  nb: "no_NO-talesyntese-medium",
  ne: "ne_NP-google-medium",
  nl: "nl_NL-mls-medium",
  no: "no_NO-talesyntese-medium",
  pl: "pl_PL-gosia-medium",
  pt: "pt_BR-faber-medium",
  ro: "ro_RO-mihai-medium",
  ru: "ru_RU-irina-medium",
  sk: "sk_SK-lili-medium",
  sl: "sl_SI-artur-medium",
  sr: "sr_RS-serbski_institut-medium",
  sv: "sv_SE-nst-medium",
  sw: "sw_CD-lanfrica-medium",
  tr: "tr_TR-dfki-medium",
  uk: "uk_UA-ukrainian_tts-medium",
  ur: "ur_PK-fasih-medium",
  vi: "vi_VN-vais1000-medium",
  zh: "zh_CN-huayan-medium",
};

/** Speaker name inside a Piper model id: "de_DE-thorsten-medium" → "thorsten". */
export function piperVoiceName(model: string): string {
  return model.split("-")[1] ?? model;
}

/** Languages Gemini TTS speaks (it detects the language from the text; the voice stays the same). */
export const GEMINI_TTS_LANGUAGES: readonly string[] = [
  "ar", "bn", "de", "en", "es", "fr", "hi", "id", "it", "ja", "ko", "mr", "nl", "pl", "pt", "ro", "ru", "ta", "te", "th", "tr", "uk", "vi",
];
