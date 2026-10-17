import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { KOKORO_MODEL, readPolylingueVoices } from "@/lib/speech/settings";
import { PIPER_LANGUAGE_MODELS, piperVoiceName } from "@/lib/speech/languages";
import { speakerForLanguage, speakerForVoice, type Speaker } from "@/lib/speech/tts";
import type { LessonContent } from "@/lib/polylingue/content";

/**
 * PolyLingue voices: an admin picks a local voice per language (Kokoro or
 * Piper on the Speaches server), and each lesson's audio is generated ahead
 * of time with it, so learners never wait for a clip. Without a choice, the
 * read-aloud model of Admin › AI model is used as before; audio is only
 * generated ahead of time with local voices (never a paid cloud voice).
 */

export interface LocalVoiceOption {
  key: string;
  label: string;
}

const kokoro = (voice: string, who: string): LocalVoiceOption => ({ key: `kokoro:${voice}`, label: `Kokoro · ${who}` });
const piper = (model: string, who: string): LocalVoiceOption => ({ key: `piper:${model}`, label: `Piper · ${who}` });

/** Local voices offered per PolyLingue language. */
export const LOCAL_VOICES: Record<string, LocalVoiceOption[]> = {
  es: [kokoro("ef_dora", "Dora (female)"), kokoro("em_alex", "Alex (male)"), kokoro("em_santa", "Santa (male)"), piper(PIPER_LANGUAGE_MODELS.es, "Dave (male, Spain)")],
  en: [
    kokoro("af_heart", "Heart (US, female)"),
    kokoro("af_bella", "Bella (US, female)"),
    kokoro("am_michael", "Michael (US, male)"),
    kokoro("bf_emma", "Emma (UK, female)"),
    kokoro("bm_george", "George (UK, male)"),
    piper("en_US-lessac-medium", "Lessac (US)"),
    piper("en_US-amy-medium", "Amy (US)"),
    piper("en_US-ryan-medium", "Ryan (US)"),
  ],
  fr: [kokoro("ff_siwis", "Siwis (female)"), piper("fr_FR-siwis-medium", "Siwis"), piper("fr_FR-tom-medium", "Tom"), piper("fr_FR-upmc-medium", "UPMC"), piper("fr_FR-gilles-low", "Gilles")],
  de: [piper(PIPER_LANGUAGE_MODELS.de, "Thorsten (male)")],
  it: [kokoro("if_sara", "Sara (female)"), kokoro("im_nicola", "Nicola (male)"), ...(PIPER_LANGUAGE_MODELS.it ? [piper(PIPER_LANGUAGE_MODELS.it, "Paola (female)")] : [])],
  pt: [kokoro("pf_dora", "Dora (female)"), kokoro("pm_alex", "Alex (male)"), kokoro("pm_santa", "Santa (male)"), ...(PIPER_LANGUAGE_MODELS.pt ? [piper(PIPER_LANGUAGE_MODELS.pt, "Faber (male, Brazil)")] : [])],
};

export function isLocalVoiceKey(lang: string, key: string): boolean {
  return (LOCAL_VOICES[lang] ?? []).some((v) => v.key === key);
}

function speakerOfKey(key: string): Speaker | null {
  const [engine, rest] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
  if (engine === "kokoro") return speakerForVoice({ engine: "kokoro", voice: rest, model: KOKORO_MODEL });
  if (engine === "piper") return speakerForVoice({ engine: "piper", voice: piperVoiceName(rest), model: `speaches-ai/piper-${rest}` });
  return null;
}

/** The voice that reads PolyLingue audio in a language: the admin's local choice, else the read-aloud model. */
export async function polylingueSpeaker(lang: string): Promise<Speaker | null> {
  const chosen = (await readPolylingueVoices())[lang];
  if (chosen && isLocalVoiceKey(lang, chosen)) return speakerOfKey(chosen);
  return speakerForLanguage(lang);
}

/** Local (free) voices only are used ahead of time. */
export function isLocalSpeaker(s: Speaker): boolean {
  return s.id === "mock" || s.id.startsWith("kokoro-") || s.id.startsWith("piper-");
}

/** Storage key of a PolyLingue clip (shared by every learner). */
export function clipKey(speaker: Speaker, lang: string, text: string): string {
  const hash = createHash("sha256").update(text).digest("hex").slice(0, 24);
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `polylingue/tts/${safe(speaker.id)}/${lang}/${hash}.${speaker.ext}`;
}

export function speechPath(lang: string, text: string): string {
  return `/api/polylingue/speech?lang=${encodeURIComponent(lang)}&text=${encodeURIComponent(text)}`;
}

/** Every text a lesson can play: its words, exercise audio and the words to match. */
export function lessonAudioTexts(content: LessonContent): string[] {
  const texts = new Set<string>();
  const add = (t: string | undefined) => {
    const clean = (t ?? "").replace(/\s+/g, " ").trim();
    if (clean && clean.length <= 400) texts.add(clean);
  };
  for (const w of content.words) add(w.term);
  for (const e of content.exercises) {
    add(e.audio);
    for (const p of e.pairs ?? []) add(p.left);
  }
  return [...texts];
}

// One lesson at a time, so the Speaches server is never flooded.
let queue: Promise<unknown> = Promise.resolve();

/**
 * Generates (once) the audio of a READY lesson with the language's voice, when
 * that voice is local. Clips already made are kept. Returns what happened.
 */
export function pregenerateLessonAudio(lessonId: string): Promise<{ generated: number; skipped: string | null }> {
  const run = queue.then(() => generate(lessonId));
  queue = run.catch(() => undefined);
  return run;
}

async function generate(lessonId: string): Promise<{ generated: number; skipped: string | null }> {
  const lesson = await prisma.langLesson.findUnique({ where: { id: lessonId }, include: { curriculum: { select: { targetLang: true } } } });
  if (!lesson || lesson.status !== "READY" || !lesson.content) return { generated: 0, skipped: "not ready" };
  const lang = lesson.curriculum.targetLang;
  const speaker = await polylingueSpeaker(lang);
  if (!speaker) return { generated: 0, skipped: "no voice for this language" };
  if (!isLocalSpeaker(speaker)) return { generated: 0, skipped: "the voice is a cloud voice: choose a local voice in Admin › PolyLingue" };
  const storage = getStorage();
  let generated = 0;
  for (const text of lessonAudioTexts(lesson.content as unknown as LessonContent)) {
    const key = clipKey(speaker, lang, text);
    const exists = await storage.read(key).then(
      () => true,
      () => false,
    );
    if (exists) continue;
    const speech = await speaker.synthesize(text);
    await storage.put(key, speech.audio, { contentType: speech.contentType });
    generated++;
  }
  await prisma.langLesson.update({ where: { id: lessonId }, data: { audioAt: new Date() } });
  return { generated, skipped: null };
}
