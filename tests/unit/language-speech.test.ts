import { describe, it, expect } from "vitest";
import { detectLanguage, normalizeLanguage } from "@/lib/language";
import { azureRegionOf } from "@/lib/env";
import { pcmToWav } from "@/lib/speech/tts";
import { speechCacheKey } from "@/lib/speech/reader";
import { ttsChoiceSchema, TTS_PROVIDERS, PIPER_MODELS } from "@/lib/speech/settings";
import { translationTarget } from "@/lib/pipelines/translate";

describe("language detection", () => {
  it("tells French from English lecture text", () => {
    expect(
      detectLanguage("Dans ce cours, nous allons voir comment la dérivée d'une fonction mesure la vitesse de changement de sa valeur et pourquoi elle est utile pour les marchés."),
    ).toBe("fr");
    expect(
      detectLanguage("In this lecture we will see how the derivative of a function measures the rate at which its value changes, and why it is useful for markets."),
    ).toBe("en");
  });

  it("does not guess on short or mixed text", () => {
    expect(detectLanguage("Ohm's law: V = I R")).toBeNull();
    expect(detectLanguage("")).toBeNull();
  });

  it("normalises Whisper and BCP-47 tags", () => {
    expect(normalizeLanguage("fr-FR")).toBe("fr");
    expect(normalizeLanguage("french")).toBe("fr");
    expect(normalizeLanguage("en")).toBe("en");
    expect(normalizeLanguage("de")).toBeNull();
    expect(normalizeLanguage(null)).toBeNull();
  });

  it("translates French sources to English only", () => {
    expect(translationTarget("fr")).toBe("en");
    expect(translationTarget("en")).toBeNull();
    expect(translationTarget(null)).toBeNull();
  });
});

describe("speech settings", () => {
  it("reads the Azure region from the portal's speech endpoint", () => {
    expect(azureRegionOf("https://eastus.tts.speech.microsoft.com")).toBe("eastus");
    expect(azureRegionOf("https://westeurope.stt.speech.microsoft.com/")).toBe("westeurope");
    expect(azureRegionOf("https://example.com")).toBeUndefined();
    expect(azureRegionOf(undefined)).toBeUndefined();
  });

  it("accepts only voices of the chosen model", () => {
    expect(ttsChoiceSchema.safeParse({ provider: "piper", voices: { en: "lessac", fr: "tom" } }).success).toBe(true);
    expect(ttsChoiceSchema.safeParse({ provider: "piper", voices: { en: "af_heart", fr: "tom" } }).success).toBe(false);
    expect(ttsChoiceSchema.safeParse({ provider: "nope", voices: { en: "a", fr: "b" } }).success).toBe(false);
  });

  it("has a Speaches model for every Piper voice and valid defaults", () => {
    for (const lang of ["en", "fr"] as const) for (const v of TTS_PROVIDERS.piper.voices[lang]) expect(PIPER_MODELS[v]).toMatch(/^speaches-ai\/piper-/);
    for (const p of Object.values(TTS_PROVIDERS)) {
      expect(p.voices.en).toContain(p.defaults.en);
      expect(p.voices.fr).toContain(p.defaults.fr);
    }
  });

  it("wraps PCM in a valid WAV header", () => {
    const wav = pcmToWav(Buffer.alloc(4800), 24_000);
    expect(wav.length).toBe(44 + 4800);
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
    expect(wav.readUInt32LE(24)).toBe(24_000);
    expect(wav.readUInt32LE(40)).toBe(4800);
  });

  it("keys cached clips by voice, language and text", () => {
    const a = speechCacheKey("p", "kokoro-af_heart-ff_siwis", "en", "segments", 3, "Hello", "mp3");
    expect(a).toMatch(/^p\/tts\/kokoro-af_heart-ff_siwis\/en\/segments-3-[0-9a-f]{16}\.mp3$/);
    expect(speechCacheKey("p", "kokoro-af_heart-ff_siwis", "en", "segments", 3, "Hello!", "mp3")).not.toBe(a);
    expect(speechCacheKey("p", "azure-x/y", "en", "segments", 3, "Hello", "mp3")).toContain("/tts/azure-x_y/");
  });
});

describe("reading languages and voices", () => {
  it("lists a source's languages: original first, then complete translations", async () => {
    const { languagesOf } = await import("@/lib/speech/reader");
    const items: { text: Record<string, string> }[] = [
      { text: { en: "a", es: "a-es", de: "a-de" } },
      { text: { en: "b", es: "b-es" } },
    ];
    expect(languagesOf(items, "en")).toEqual(["en", "es"]);
    expect(languagesOf([], "fr")).toEqual(["fr"]);
  });

  it("maps translator codes to Azure locales", async () => {
    const { azureLocaleCandidates } = await import("@/lib/speech/tts");
    expect(azureLocaleCandidates("de")).toEqual(["de-de", "de"]);
    expect(azureLocaleCandidates("zh-Hans")).toEqual(["zh-cn"]);
    expect(azureLocaleCandidates("zh-Hant")).toEqual(["zh-tw", "zh-hk"]);
    expect(azureLocaleCandidates("pt-PT")).toEqual(["pt-pt", "pt"]);
  });

  it("chooses a local voice per language, Kokoro first unless Piper is selected", async () => {
    const { resolveVoice } = await import("@/lib/speech/tts");
    const kokoro = { provider: "kokoro" as const, voices: { en: "af_heart", fr: "ff_siwis" } };
    const piper = { provider: "piper" as const, voices: { en: "lessac", fr: "siwis" } };
    expect(await resolveVoice("es", kokoro)).toMatchObject({ engine: "kokoro", voice: "ef_dora" });
    expect(await resolveVoice("de", kokoro)).toMatchObject({ engine: "piper", voice: "thorsten", model: "speaches-ai/piper-de_DE-thorsten-medium" });
    expect(await resolveVoice("es", piper)).toMatchObject({ engine: "piper", voice: "davefx" });
    expect(await resolveVoice("ja", piper)).toMatchObject({ engine: "kokoro", voice: "jf_alpha" });
    expect(await resolveVoice("fr", piper)).toMatchObject({ engine: "piper", voice: "siwis" });
    expect(await resolveVoice("en", kokoro)).toMatchObject({ engine: "kokoro", voice: "af_heart" });
  });

  it("names languages and offers a local list when Azure is not used", async () => {
    const { languageName, translationLanguages } = await import("@/lib/speech/languages");
    expect(languageName("es")).toBe("Spanish");
    expect(languageName("zh-Hans")).toMatch(/Chinese/);
    const local = await translationLanguages("local");
    expect(local.map((l) => l.code)).toEqual(expect.arrayContaining(["es", "de", "ja"]));
  });
});
