import { z } from "zod";
import { EXERCISE_TYPES, type ExerciseType } from "@/lib/polylingue/levels";

/**
 * What the AI model writes for PolyLingue (validated JSON), and the clean-up
 * applied before a lesson is stored. Pure (no server imports): the browser
 * uses the types too.
 */

export const outlineSchema = z.object({
  units: z
    .array(
      z.object({
        title: z.string().min(1).max(80),
        theme: z.string().max(200),
        grammar: z.string().max(200),
        lessons: z.array(z.object({ title: z.string().min(1).max(80), focus: z.string().max(200) })).min(3).max(6),
      }),
    )
    .min(3)
    .max(8),
});
export type Outline = z.infer<typeof outlineSchema>;

/**
 * One exercise, as a flat object every structured-output provider accepts.
 * - prompt: the instruction or question, in the explanation language
 * - text: target-language sentence the exercise works on (heard, arranged, with a {{blank}}, or to translate)
 * - answer / accepted: expected answer and other correct answers
 * - options: choices (choice, listen; optional for cloze)
 * - pairs: target ↔ explanation-language pairs (match)
 * - explanation: one line shown after the answer
 * - audio: target-language text read aloud with the exercise ("" for none)
 */
export const exerciseSchema = z.object({
  type: z.enum(EXERCISE_TYPES),
  prompt: z.string().min(1).max(300),
  text: z.string().max(400),
  answer: z.string().max(300),
  accepted: z.array(z.string().max(300)).max(6),
  options: z.array(z.string().max(200)).max(6),
  pairs: z.array(z.object({ left: z.string().max(120), right: z.string().max(120) })).max(6),
  explanation: z.string().max(400),
  audio: z.string().max(400),
});
export type Exercise = z.infer<typeof exerciseSchema>;

export const wordSchema = z.object({
  term: z.string().min(1).max(80),
  translation: z.string().min(1).max(120),
  example: z.string().max(240),
  exampleTranslation: z.string().max(240),
  partOfSpeech: z.string().max(40),
});
export type LessonWord = z.infer<typeof wordSchema>;

export const lessonContentSchema = z.object({
  /** What the lesson teaches and one grammar tip, in the explanation language. */
  intro: z.string().max(700),
  words: z.array(wordSchema).min(3).max(10),
  exercises: z.array(exerciseSchema).min(6).max(16),
});
export type LessonContent = z.infer<typeof lessonContentSchema>;

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const key = (s: string) => clean(s).toLowerCase();

/** Cloze sentences mark the blank as {{word}}. */
export const BLANK = /\{\{(.+?)\}\}/;

/**
 * Makes one generated exercise playable, or drops it (null): answer among the
 * options, enough options or pairs, a blank in cloze sentences, several words
 * to arrange, and so on.
 */
export function normalizeExercise(raw: Exercise): Exercise | null {
  const e: Exercise = {
    type: raw.type,
    prompt: clean(raw.prompt),
    text: clean(raw.text),
    answer: clean(raw.answer),
    accepted: [...new Set(raw.accepted.map(clean).filter(Boolean))].filter((a) => key(a) !== key(raw.answer)),
    options: [...new Map(raw.options.map(clean).filter(Boolean).map((o) => [key(o), o])).values()],
    pairs: raw.pairs.map((p) => ({ left: clean(p.left), right: clean(p.right) })).filter((p) => p.left && p.right),
    explanation: clean(raw.explanation),
    audio: clean(raw.audio),
  };
  if (!e.prompt) return null;
  switch (e.type as ExerciseType) {
    case "choice":
    case "listen": {
      if (!e.answer) return null;
      if (!e.options.some((o) => key(o) === key(e.answer))) e.options.unshift(e.answer);
      const others = e.options.filter((o) => key(o) !== key(e.answer)).slice(0, 3);
      if (others.length < 2) return null;
      e.options = [e.options.find((o) => key(o) === key(e.answer)) as string, ...others];
      if (e.type === "listen") {
        if (!e.audio) e.audio = e.text;
        if (!e.audio) return null;
      }
      return e;
    }
    case "match": {
      const lefts = new Set<string>();
      const rights = new Set<string>();
      e.pairs = e.pairs.filter((p) => {
        const ok = !lefts.has(key(p.left)) && !rights.has(key(p.right));
        lefts.add(key(p.left));
        rights.add(key(p.right));
        return ok;
      });
      if (e.pairs.length < 3) return null;
      e.pairs = e.pairs.slice(0, 5);
      e.answer = "match";
      e.options = [];
      return e;
    }
    case "order": {
      const sentence = e.answer || e.text;
      if (sentence.split(" ").length < 3) return null;
      e.answer = sentence;
      e.text = sentence;
      if (!e.audio) e.audio = sentence;
      e.options = [];
      return e;
    }
    case "cloze": {
      const m = BLANK.exec(e.text);
      if (!m) return null;
      if (!e.answer) e.answer = clean(m[1]);
      if (e.options.length && !e.options.some((o) => key(o) === key(e.answer))) e.options.unshift(e.answer);
      if (!e.audio) e.audio = e.text.replace(BLANK, (_x, w: string) => w);
      return e;
    }
    case "translate": {
      if (!e.answer) return null;
      e.options = [];
      return e;
    }
    default:
      return null;
  }
}

/** Clean-up of a whole generated lesson; throws when too little is playable. */
export function normalizeLesson(input: LessonContent): LessonContent {
  const raw = cleanGenerated(input);
  const exercises = raw.exercises.map(normalizeExercise).filter((e): e is Exercise => e !== null);
  if (exercises.length < 5) throw new Error(`Only ${exercises.length} usable exercises were generated`);
  const seen = new Set<string>();
  const words = raw.words
    .map((w) => ({ ...w, term: clean(w.term), translation: clean(w.translation), example: clean(w.example), exampleTranslation: clean(w.exampleTranslation), partOfSpeech: clean(w.partOfSpeech) }))
    .filter((w) => w.term && w.translation && !seen.has(key(w.term)) && seen.add(key(w.term)));
  return { intro: clean(raw.intro), words, exercises };
}

/** What the learner's browser receives: the cloze blank hidden, everything needed to play. */
export function exerciseForPlayer(e: Exercise) {
  return {
    type: e.type,
    prompt: e.prompt,
    text: e.type === "cloze" ? e.text.replace(BLANK, "____") : e.type === "order" ? "" : e.text,
    options: e.options,
    pairs: e.pairs,
    /** Audio that would give the answer away (the full cloze or ordered sentence) is only played in the feedback. */
    audio: revealsAnswer(e) ? "" : e.audio,
    /** Words to arrange (order), shuffled by the player. */
    tokens: e.type === "order" ? e.answer.split(" ") : [],
  };
}
export type PlayerExercise = ReturnType<typeof exerciseForPlayer>;

function revealsAnswer(e: Exercise): boolean {
  if (e.type === "cloze" || e.type === "order") return true;
  if (e.type === "translate" && e.audio) return key(e.audio).includes(key(e.answer));
  return false;
}

/**
 * Citation artefacts some models add to texts, especially in academic styles
 * ("[Source 1]", "[Sources 2–3]", "(source 4)", "[1]", "[1, 2]"): meaningless
 * to a learner, so they are removed from every generated string.
 */
const SOURCE_MARKER = /\s*[[(]\s*(?:sources?|src|refs?\.?|réf(?:érence)?s?\.?|fuentes?|quellen?|fonti?|fontes?|citations?)\s*\d+(?:\s*(?:[,;–-]|and|et|y|und|e)\s*\d+)*\s*[\])]|\s*\[\d+(?:\s*[,;–-]\s*\d+)*\]/giu;

export function stripSourceMarkers(text: string): string {
  return text.replace(SOURCE_MARKER, "").replace(/[ \t]+([.,;:!?])/g, "$1").replace(/[ \t]{2,}/g, " ");
}

/** Applies stripSourceMarkers to every string of a generated object (lesson or practice). */
export function cleanGenerated<T>(value: T): T {
  if (typeof value === "string") return stripSourceMarkers(value) as unknown as T;
  if (Array.isArray(value)) return value.map(cleanGenerated) as unknown as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, cleanGenerated(v)])) as T;
  }
  return value;
}
