import { z } from "zod";
import type { Cefr } from "@/lib/polylingue/levels";
import { foldAccents, normalizeAnswer } from "@/lib/polylingue/check";
import { cleanGenerated } from "@/lib/polylingue/content";

/**
 * Multi-skill practice (reading, listening, writing, speaking): what the AI
 * model writes for each skill, sized per CEFR level, what the browser may see
 * before answering, and the scoring of a spoken sentence. Pure (no server
 * imports): the browser uses the types too.
 */

export const SKILLS = ["READING", "LISTENING", "WRITING", "SPEAKING"] as const;
export type Skill = (typeof SKILLS)[number];
export const SKILL_SLUGS: Record<Skill, string> = { READING: "reading", LISTENING: "listening", WRITING: "writing", SPEAKING: "speaking" };
export function skillFromSlug(slug: string): Skill | null {
  return (Object.entries(SKILL_SLUGS).find(([, s]) => s === slug)?.[0] as Skill | undefined) ?? null;
}
export const SKILL_LABELS: Record<Skill, string> = { READING: "Reading", LISTENING: "Listening", WRITING: "Writing", SPEAKING: "Speaking" };

/** Size of each practice per level. */
export const PRACTICE_SIZES: Record<Cefr, { readingWords: number; listeningSentences: number; writingWords: [number, number]; questions: number }> = {
  A1: { readingWords: 70, listeningSentences: 4, writingWords: [20, 40], questions: 4 },
  A2: { readingWords: 120, listeningSentences: 5, writingWords: [40, 70], questions: 4 },
  B1: { readingWords: 180, listeningSentences: 6, writingWords: [80, 120], questions: 5 },
  B2: { readingWords: 260, listeningSentences: 8, writingWords: [150, 200], questions: 5 },
  C1: { readingWords: 350, listeningSentences: 9, writingWords: [200, 250], questions: 6 },
  C2: { readingWords: 450, listeningSentences: 10, writingWords: [250, 300], questions: 6 },
};

const question = z.object({
  question: z.string().min(1).max(300),
  options: z.array(z.string().min(1).max(200)).min(3).max(4),
  answer: z.string().min(1).max(200),
  explanation: z.string().max(400),
});
export type Question = z.infer<typeof question>;

export const readingSchema = z.object({
  title: z.string().min(1).max(120),
  /** The text, in the target language. */
  text: z.string().min(20).max(4000),
  /** Words of the text worth learning, with their meaning in the explanation language (a definition at B2+). */
  glossary: z.array(z.object({ term: z.string().min(1).max(80), meaning: z.string().min(1).max(160) })).min(3).max(12),
  questions: z.array(question).min(3).max(8),
});

export const listeningSchema = z.object({
  title: z.string().min(1).max(120),
  /** Short sentences to listen to and type (dictation). */
  dictation: z.array(z.string().min(2).max(200)).min(3).max(6),
  /** A short monologue or dialogue, one sentence per item (each is played in turn). */
  passage: z.array(z.string().min(2).max(300)).min(3).max(12),
  questions: z.array(question).min(3).max(8),
});

export const writingSchema = z.object({
  tasks: z
    .array(
      z.object({
        prompt: z.string().min(1).max(500),
        minWords: z.number().int().min(5).max(400),
        maxWords: z.number().int().min(10).max(500),
        /** Useful words and structures to use. */
        hints: z.array(z.string().max(120)).max(8),
        /** A model answer, shown after the learner's correction. */
        model: z.string().max(3000),
      }),
    )
    .min(1)
    .max(3),
});

export const speakingSchema = z.object({
  /** Sentences to read aloud after the model. */
  sentences: z.array(z.object({ text: z.string().min(2).max(240), meaning: z.string().max(240) })).min(3).max(8),
  /** Open questions answered aloud; the transcript is corrected like a writing task. */
  questions: z.array(z.object({ prompt: z.string().min(1).max(300), model: z.string().max(1000) })).min(1).max(3),
});

export type ReadingContent = z.infer<typeof readingSchema>;
export type ListeningContent = z.infer<typeof listeningSchema>;
export type WritingContent = z.infer<typeof writingSchema>;
export type SpeakingContent = z.infer<typeof speakingSchema>;
export type PracticeContent = ReadingContent | ListeningContent | WritingContent | SpeakingContent;

export const PRACTICE_SCHEMAS = { READING: readingSchema, LISTENING: listeningSchema, WRITING: writingSchema, SPEAKING: speakingSchema } as const;

/** Every question's right answer is one of its options (added if missing). */
function fixQuestions(qs: Question[]): Question[] {
  return qs
    .map((q) => {
      const options = [...new Set(q.options.map((o) => o.trim()).filter(Boolean))];
      const answer = q.answer.trim();
      if (!options.some((o) => normalizeAnswer(o) === normalizeAnswer(answer))) options.unshift(answer);
      return { ...q, answer, options: options.slice(0, 4) };
    })
    .filter((q) => q.options.length >= 3);
}

export function normalizePractice(skill: Skill, input: PracticeContent): PracticeContent {
  const raw = cleanGenerated(input);
  if (skill === "READING") {
    const r = raw as ReadingContent;
    return { ...r, questions: fixQuestions(r.questions) };
  }
  if (skill === "LISTENING") {
    const l = raw as ListeningContent;
    return { ...l, questions: fixQuestions(l.questions) };
  }
  if (skill === "WRITING") {
    const w = raw as WritingContent;
    return { tasks: w.tasks.map((t) => ({ ...t, maxWords: Math.max(t.maxWords, t.minWords + 5) })) };
  }
  return raw;
}

/** What the browser receives before answering: no answers, no dictation text, no model answers. */
export function practiceForPlayer(skill: Skill, content: PracticeContent) {
  switch (skill) {
    case "READING": {
      const r = content as ReadingContent;
      return { skill, title: r.title, text: r.text, glossary: r.glossary, questions: r.questions.map((q) => ({ question: q.question, options: q.options })) };
    }
    case "LISTENING": {
      const l = content as ListeningContent;
      return {
        skill,
        title: l.title,
        /** Audio only: the sentences are fetched as audio by index, their text comes with the correction. */
        dictationCount: l.dictation.length,
        passageCount: l.passage.length,
        questions: l.questions.map((q) => ({ question: q.question, options: q.options })),
      };
    }
    case "WRITING": {
      const w = content as WritingContent;
      return { skill, tasks: w.tasks.map((t) => ({ prompt: t.prompt, minWords: t.minWords, maxWords: t.maxWords, hints: t.hints })) };
    }
    default: {
      const s = content as SpeakingContent;
      return { skill, sentences: s.sentences, questions: s.questions.map((q) => ({ prompt: q.prompt })) };
    }
  }
}
export type PlayerPractice = ReturnType<typeof practiceForPlayer>;

/** Words of a sentence for comparison: lower case, no punctuation or accents. */
export function wordsOf(s: string): string[] {
  return foldAccents(normalizeAnswer(s)).split(" ").filter(Boolean);
}

/**
 * Compares what the learner said (Whisper's transcript) with the sentence:
 * longest common subsequence of words; the score is the share of the
 * sentence's words that were said, in order; the missed words are listed.
 */
export function scoreSpoken(expected: string, heard: string): { score: number; missed: string[]; heardWords: string[] } {
  const a = wordsOf(expected);
  const b = wordsOf(heard);
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const matched = new Set<number>();
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      matched.add(i);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  const original = normalizeAnswer(expected).split(" ").filter(Boolean);
  const missed = original.filter((_, k) => !matched.has(k));
  return { score: a.length ? Math.round((matched.size / a.length) * 100) : 0, missed, heardWords: b };
}

/** AI correction of a written (or transcribed spoken) answer. */
export const correctionSchema = z.object({
  /** 0–100 for the level: task done, accuracy, vocabulary range. */
  score: z.number().int().min(0).max(100),
  corrected: z.string().max(4000),
  corrections: z
    .array(z.object({ original: z.string().max(300), corrected: z.string().max(300), explanation: z.string().max(300) }))
    .max(12),
  feedback: z.string().max(800),
});
export type Correction = z.infer<typeof correctionSchema>;

/** Quick AI judgement of an open rewriting answer (immersion lessons). */
export const judgeSchema = z.object({ correct: z.boolean(), note: z.string().max(300) });

/** Kinds of source a learner can ask a personal reading to imitate. */
export const READING_FORMATS = [
  { id: "newspaper", label: "Newspaper article", prompt: "a newspaper article (headline, lead paragraph, facts, a quotation)" },
  { id: "magazine", label: "Magazine feature", prompt: "a magazine feature (engaging, personal angle, subheadings)" },
  { id: "novel", label: "Novel extract", prompt: "an extract from a novel (narration, characters, some dialogue)" },
  { id: "textbook", label: "Textbook section", prompt: "a textbook section (clear explanations, key terms, an example)" },
  { id: "thesis", label: "Research thesis excerpt", prompt: "an excerpt from a research thesis (research question, method or findings, cautious academic tone)" },
] as const;
export type ReadingFormat = (typeof READING_FORMATS)[number]["id"];

/** Subjects for personal readings ("custom" uses the learner's own words). */
export const READING_TOPICS = [
  { id: "history", label: "History" },
  { id: "news", label: "News and current affairs" },
  { id: "literature", label: "Literature" },
  { id: "scifi", label: "Science fiction" },
  { id: "custom", label: "My own topic" },
] as const;
export type ReadingTopic = (typeof READING_TOPICS)[number]["id"];
