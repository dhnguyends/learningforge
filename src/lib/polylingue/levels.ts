/**
 * PolyLingue levels and languages. Pure data, shared by the server (prompts,
 * validation) and the browser (onboarding), so no server imports here.
 */

export const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
export type Cefr = (typeof CEFR_LEVELS)[number];

export interface LevelProfile {
  level: Cefr;
  name: string;
  /** What a learner at this level can do (CEFR global scale, shortened). */
  canDo: string;
  /** Themes the course covers at this level. */
  themes: string;
  /** Grammar the course covers at this level. */
  grammar: string;
  /** Longest target-language sentence in exercises, in words. */
  maxSentenceWords: number;
  /** New words per lesson. */
  newWords: number;
  /** Exercises per lesson. */
  exercises: number;
  units: number;
  lessonsPerUnit: number;
  /**
   * Immersion (B2 and up): the whole course (titles, instructions,
   * explanations, word meanings) is written in the language being learned.
   */
  immersion: boolean;
  /**
   * Exercise mix: recognition (choice, listen, match) early, production
   * (translate into the target, word order, fill in) as the level rises.
   */
  mix: Record<ExerciseType, number>;
}

export const EXERCISE_TYPES = ["choice", "listen", "match", "order", "cloze", "translate"] as const;
export type ExerciseType = (typeof EXERCISE_TYPES)[number];

export const LEVELS: Record<Cefr, LevelProfile> = {
  A1: {
    level: "A1",
    immersion: false,
    name: "Beginner",
    canDo: "Understands and uses familiar everyday expressions and very basic phrases; introduces themselves and others.",
    themes: "greetings, introducing yourself, numbers, family, food and drinks, days and time, the classroom, colours, shopping basics",
    grammar: "personal pronouns, present tense of the most common verbs, articles and gender, plurals, basic questions, negation",
    maxSentenceWords: 6,
    newWords: 6,
    exercises: 10,
    units: 6,
    lessonsPerUnit: 5,
    mix: { choice: 3, listen: 2, match: 2, order: 1, cloze: 1, translate: 1 },
  },
  A2: {
    level: "A2",
    immersion: false,
    name: "Elementary",
    canDo: "Understands frequently used sentences about personal life, shopping, work and the local area; handles simple routine exchanges.",
    themes: "daily routine, home, town and directions, shopping and prices, health, hobbies, weather, travel basics",
    grammar: "past tense of common verbs, near future, possessives, comparatives, prepositions of place and time, frequency adverbs",
    maxSentenceWords: 9,
    newWords: 7,
    exercises: 12,
    units: 6,
    lessonsPerUnit: 5,
    mix: { choice: 2, listen: 2, match: 2, order: 2, cloze: 2, translate: 2 },
  },
  B1: {
    level: "B1",
    immersion: false,
    name: "Intermediate",
    canDo: "Deals with most situations while travelling; describes experiences, events, hopes and plans, and briefly gives reasons and opinions.",
    themes: "travel and accommodation, work and studies, experiences and stories, media, environment, plans and ambitions",
    grammar: "past tenses in contrast, future, conditional, relative clauses, connectors, reported speech basics",
    maxSentenceWords: 13,
    newWords: 7,
    exercises: 12,
    units: 6,
    lessonsPerUnit: 4,
    mix: { choice: 2, listen: 2, match: 1, order: 2, cloze: 2, translate: 3 },
  },
  B2: {
    level: "B2",
    immersion: true,
    name: "Upper intermediate",
    canDo: "Understands the main ideas of complex texts; interacts fluently with native speakers; writes clear, detailed text and argues a viewpoint.",
    themes: "society and culture, science and technology, the workplace, debate and opinion, news, arts",
    grammar: "subjunctive or its equivalent, passive voice, complex conditionals, nuanced connectors, collocations",
    maxSentenceWords: 18,
    newWords: 8,
    exercises: 12,
    units: 6,
    lessonsPerUnit: 4,
    mix: { choice: 1, listen: 2, match: 1, order: 2, cloze: 3, translate: 3 },
  },
  C1: {
    level: "C1",
    immersion: true,
    name: "Advanced",
    canDo: "Understands demanding, longer texts and implicit meaning; expresses ideas fluently and spontaneously for social, academic and professional purposes.",
    themes: "academic and professional discourse, persuasion, idioms and register, current affairs, literature extracts",
    grammar: "advanced tense and mood choices, nominalisation, emphasis and inversion, idiomatic and register-sensitive structures",
    maxSentenceWords: 22,
    newWords: 8,
    exercises: 12,
    units: 6,
    lessonsPerUnit: 4,
    mix: { choice: 1, listen: 2, match: 1, order: 1, cloze: 3, translate: 4 },
  },
  C2: {
    level: "C2",
    immersion: true,
    name: "Proficient",
    canDo: "Understands virtually everything heard or read; expresses themselves precisely, distinguishing finer shades of meaning even in complex situations.",
    themes: "abstract and specialised topics, rhetoric, humour and wordplay, style and register shifts, cultural references",
    grammar: "stylistic choices, rare and literary forms, fine distinctions between near-synonyms and constructions",
    maxSentenceWords: 26,
    newWords: 8,
    exercises: 12,
    units: 6,
    lessonsPerUnit: 4,
    mix: { choice: 1, listen: 2, match: 1, order: 1, cloze: 3, translate: 4 },
  },
};

/** Languages offered in the MVP (all have good local voices). */
export const TARGET_LANGUAGES = [
  { code: "es", name: "Spanish", native: "Español", flag: "🇪🇸" },
  { code: "en", name: "English", native: "English", flag: "🇬🇧" },
  { code: "fr", name: "French", native: "Français", flag: "🇫🇷" },
  { code: "de", name: "German", native: "Deutsch", flag: "🇩🇪" },
  { code: "it", name: "Italian", native: "Italiano", flag: "🇮🇹" },
  { code: "pt", name: "Portuguese", native: "Português", flag: "🇵🇹" },
] as const;
export type TargetLanguage = (typeof TARGET_LANGUAGES)[number]["code"];

/** Languages explanations, hints and translations can be given in. */
export const BASE_LANGUAGES = [
  { code: "en", name: "English" },
  { code: "fr", name: "Français" },
] as const;
export type BaseLanguage = (typeof BASE_LANGUAGES)[number]["code"];

export const DAILY_GOALS = [5, 10, 15, 20] as const;

export function targetLanguage(code: string) {
  return TARGET_LANGUAGES.find((l) => l.code === code);
}

export function languageEnglishName(code: string): string {
  return TARGET_LANGUAGES.find((l) => l.code === code)?.name ?? (code === "fr" ? "French" : code === "en" ? "English" : code);
}

export function isImmersion(level: string): boolean {
  return LEVELS[level as Cefr]?.immersion ?? false;
}

/**
 * The explanation language a curriculum is written in: the learner's at
 * A1–B1, the target language itself from B2 (so immersion courses are shared
 * by every learner of that language and level, whatever their own language).
 */
export function curriculumBaseLang(targetLang: string, baseLang: string, level: string): string {
  return isImmersion(level) ? targetLang : baseLang;
}
