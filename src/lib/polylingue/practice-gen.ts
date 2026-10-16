import { z } from "zod";
import { prisma } from "@/lib/db";
import { getGenerator } from "@/lib/ai";
import { LEVELS, languageEnglishName, type Cefr } from "@/lib/polylingue/levels";
import {
  READING_FORMATS,
  PRACTICE_SCHEMAS,
  PRACTICE_SIZES,
  SKILL_LABELS,
  correctionSchema,
  judgeSchema,
  normalizePractice,
  type Correction,
  type PracticeContent,
  type Skill,
} from "@/lib/polylingue/practice";

/**
 * Writes multi-skill practice with the selected AI model: one practice per
 * skill and unit, on the unit's theme and grammar, at the curriculum's level;
 * shared by every learner of that curriculum. Also corrects learners' writing.
 */

const STALE_MS = 10 * 60 * 1000;

/** The explanation language of a curriculum: the target language itself at immersion levels. */
function languages(target: string, base: string, level: Cefr) {
  const T = languageEnglishName(target);
  return { T, E: LEVELS[level].immersion ? T : languageEnglishName(base) };
}

/** Practice rows for every unit of a curriculum and one skill (created on first visit). */
export async function ensurePractices(curriculumId: string, skill: Skill) {
  const c = await prisma.langCurriculum.findUniqueOrThrow({ where: { id: curriculumId } });
  const units = ((c.outline as { units?: { title: string }[] })?.units ?? []).map((u, unitIndex) => ({ unitIndex, title: u.title }));
  if (units.length) {
    await prisma.langPractice.createMany({
      data: units.map((u) => ({ curriculumId, skill, unitIndex: u.unitIndex, title: `${u.title}` })),
      skipDuplicates: true,
    });
  }
  return prisma.langPractice.findMany({ where: { curriculumId, skill, courseId: null }, orderBy: { unitIndex: "asc" } });
}

export async function preparePractice(practiceId: string): Promise<void> {
  const claimed = await prisma.langPractice.updateMany({
    where: {
      id: practiceId,
      OR: [{ status: { in: ["QUEUED", "FAILED"] } }, { status: "GENERATING", updatedAt: { lt: new Date(Date.now() - STALE_MS) } }],
    },
    data: { status: "GENERATING", error: null },
  });
  if (claimed.count === 0) return;
  const practice = await prisma.langPractice.findUniqueOrThrow({ where: { id: practiceId }, include: { curriculum: true } });
  const { targetLang, baseLang } = practice.curriculum;
  const level = practice.curriculum.level as Cefr;
  const units = (practice.curriculum.outline as { units?: { title: string; theme: string; grammar: string; lessons: { title: string }[] }[] })?.units ?? [];
  const unit = practice.unitIndex == null ? undefined : units[practice.unitIndex];
  const lessons =
    practice.unitIndex == null
      ? []
      : await prisma.langLesson.findMany({ where: { curriculumId: practice.curriculumId, unitIndex: practice.unitIndex }, select: { title: true, focus: true } });
  const { T, E } = languages(targetLang, baseLang, level);
  const p = LEVELS[level];
  const size = PRACTICE_SIZES[level];
  const format = READING_FORMATS.find((f) => f.id === practice.format);
  const context = format
    ? // Personal reading: the learner chose the kind of source and the subject; the level stays the course's.
      `The learner asked for ${format.prompt} about: ${practice.topic}. Imitate that kind of source faithfully (layout, tone, typical phrases), ` +
      `simplified as needed so it stays fully readable at ${level} (${p.name}): vocabulary and grammar of this level only (${p.grammar}); ` +
      `${T} sentences of at most ${p.maxSentenceWords + 4} words.\n`
    : `Unit "${unit?.title ?? practice.title}": theme ${unit?.theme ?? ""}; grammar ${unit?.grammar ?? ""}. ` +
      `Its lessons: ${lessons.map((l) => `${l.title} (${l.focus})`).join("; ")}.\n` +
      `Use the unit's vocabulary and grammar and earlier ${level} material; ${T} sentences of at most ${p.maxSentenceWords + 4} words.\n`;
  const userBySkill: Record<Skill, string> = {
    READING:
      context +
      `Write a ${SKILL_LABELS.READING.toLowerCase()} practice: "title" (${E}); "text": ${
        format ? `the ${T} text in that style` : `an authentic-style ${T} text on the unit's theme (a message, article, story or dialogue suited to ${level})`
      }, about ${size.readingWords} words; "glossary": 5 to 10 useful words of the text, each with its meaning in ${E}` +
      `${p.immersion ? " (a short definition)" : ""}; "questions": exactly ${size.questions} comprehension questions in ${E}, each with 4 "options" in ${E}, ` +
      `"answer" = the exact right option, and a one-line "explanation" in ${E} quoting the text.`,
    LISTENING:
      context +
      `Write a ${SKILL_LABELS.LISTENING.toLowerCase()} practice (the learner only hears the ${T}): "title" (${E}); "dictation": 4 short ${T} sentences to type after hearing them; ` +
      `"passage": a ${T} monologue or dialogue of exactly ${size.listeningSentences} sentences, one sentence per item (for a dialogue, start each item with the speaker's name and a colon); ` +
      `"questions": exactly ${size.questions} questions in ${E} about the passage, each with 4 "options" in ${E}, "answer" = the exact right option, and a one-line "explanation" in ${E}.`,
    WRITING:
      context +
      `Write a ${SKILL_LABELS.WRITING.toLowerCase()} practice: "tasks": 2 writing tasks on the unit's theme for ${level} (for example a message, an email, a description, an opinion), ` +
      `each with "prompt" (the instruction in ${E}, giving the situation and what to include), "minWords" ${size.writingWords[0]} and "maxWords" ${size.writingWords[1]}, ` +
      `"hints": 3 to 6 useful ${T} words or structures, and "model": a model answer in ${T} of the requested length.`,
    SPEAKING:
      context +
      `Write a ${SKILL_LABELS.SPEAKING.toLowerCase()} practice: "sentences": 5 ${T} sentences to read aloud after a model (useful, natural, using the unit's words), ` +
      `each with its "meaning" in ${E}; "questions": 2 open questions in ${E} that the learner answers aloud in ${T} in a few sentences, each with a short "model" answer in ${T}.`,
  };
  try {
    const result = await (await getGenerator()).generate({
      system:
        `You are an expert ${T} teacher writing CEFR ${level} (${p.name}) practice material: ${p.canDo} ` +
        (p.immersion ? `This is an immersion course: everything is written in ${T} only. ` : `Instructions and questions are in ${E}. `) +
        `Use natural, standard, correctly spelled ${T} with every accent. Never add citations, footnotes or source markers such as [Source 1] or [1]. ` +
        "Return ONLY one JSON object matching the requested structure.",
      user: userBySkill[practice.skill],
      schema: PRACTICE_SCHEMAS[practice.skill],
      temperature: 0.6,
      maxTokens: 7000,
      mock: () => mockPractice(practice.skill, targetLang),
    });
    const content = normalizePractice(practice.skill, result.data as PracticeContent);
    const title = "title" in content && content.title ? content.title : practice.title;
    await prisma.langPractice.update({
      where: { id: practiceId },
      data: { status: "READY", content: content as object, title, model: `${result.provider}:${result.model}` },
    });
  } catch (err) {
    await prisma.langPractice.update({ where: { id: practiceId }, data: { status: "FAILED", error: err instanceof Error ? err.message.slice(0, 500) : String(err) } });
  }
}

/** Corrects a learner's text (written, or transcribed from speech) with explanations in the course's explanation language. */
export async function correctText(opts: {
  target: string;
  base: string;
  level: Cefr;
  task: string;
  text: string;
  minWords?: number;
  maxWords?: number;
  spoken?: boolean;
}): Promise<Correction> {
  const { T, E } = languages(opts.target, opts.base, opts.level);
  const result = await (await getGenerator()).generate({
    system:
      `You are a kind, precise ${T} teacher correcting a CEFR ${opts.level} learner. Write "corrected", "corrections" (original fragment, corrected fragment, ` +
      `a short explanation in ${E}) and "feedback" (2–3 encouraging sentences in ${E}: what is good, the main thing to improve). ` +
      `"score" (0–100) rates the answer for the ${opts.level} level: task completed, accuracy, vocabulary range. ` +
      (opts.spoken ? "The answer was spoken and transcribed automatically: ignore punctuation and capital letters. " : "") +
      "Return ONLY one JSON object.",
    user:
      `Task: ${opts.task}\n` +
      (opts.minWords ? `Expected length: ${opts.minWords}–${opts.maxWords} words.\n` : "") +
      `Learner's answer:\n${opts.text}`,
    schema: correctionSchema,
    temperature: 0.2,
    maxTokens: 3000,
    mock: () => ({
      score: Math.min(100, 40 + opts.text.split(/\s+/).length),
      corrected: opts.text,
      corrections: [],
      feedback: "Good effort. Keep practising.",
    }),
  });
  return result.data;
}

/** Is an open rewriting answer acceptable? (Immersion lessons, when it is not in the accepted list.) */
export async function judgeRewrite(opts: { target: string; level: Cefr; prompt: string; expected: string; given: string }) {
  const T = languageEnglishName(opts.target);
  const result = await (await getGenerator()).generate({
    system: `You check ${T} answers to rewriting exercises for CEFR ${opts.level}. Accept any correct, natural answer that does what the instruction asks, not only the model answer. Write "note" in ${T}. Return ONLY JSON.`,
    user: `Instruction: ${opts.prompt}\nModel answer: ${opts.expected}\nLearner's answer: ${opts.given}`,
    schema: judgeSchema,
    temperature: 0,
    maxTokens: 300,
    mock: () => ({ correct: false, note: "" }),
  });
  return result.data;
}

// ------------------------------------------------------------ offline mocks

function mockPractice(skill: Skill, target: string): PracticeContent {
  const t = (s: string) => `${target} ${s}`;
  const q = (n: number) => ({ question: `Question ${n}?`, options: ["right", "wrong 1", "wrong 2", "wrong 3"], answer: "right", explanation: "Because the text says so." });
  switch (skill) {
    case "READING":
      return {
        title: "A short text",
        text: t("Maria lives in a small town. She works at the market and likes fresh bread."),
        glossary: [
          { term: t("market"), meaning: "market" },
          { term: t("bread"), meaning: "bread" },
          { term: t("town"), meaning: "town" },
        ],
        questions: [q(1), q(2), q(3)],
      };
    case "LISTENING":
      return {
        title: "At the market",
        dictation: [t("good morning"), t("thank you very much"), t("see you tomorrow")],
        passage: [t("Ana: Hello!"), t("Luis: Hello, how are you?"), t("Ana: Very well, thanks.")],
        questions: [q(1), q(2), q(3)],
      };
    case "WRITING":
      return { tasks: [{ prompt: "Describe your town.", minWords: 20, maxWords: 40, hints: [t("there is")], model: t("My town is small and quiet.") }] };
    default:
      return {
        sentences: [
          { text: t("good morning"), meaning: "good morning" },
          { text: t("my name is Ana"), meaning: "my name is Ana" },
          { text: t("I live in Paris"), meaning: "I live in Paris" },
        ],
        questions: [{ prompt: "Introduce yourself.", model: t("I am Ana and I live in Paris.") }],
      };
  }
}

const hintSchema = z.object({ hint: z.string().min(1).max(300) });

/**
 * A hint for a lesson exercise: points the learner in the right direction
 * (the rule, the meaning, the word family) without giving the answer, in the
 * course's explanation language.
 */
export async function writeHint(opts: { target: string; base: string; level: Cefr; exercise: { type: string; prompt: string; text: string; answer: string; options: string[] } }): Promise<string> {
  const { T, E } = languages(opts.target, opts.base, opts.level);
  const e = opts.exercise;
  const result = await (await getGenerator()).generate({
    system: `You are a supportive ${T} teacher for CEFR ${opts.level}. Write ONE short hint in ${E} (max 25 words). NEVER give the answer or any word of it; point to the rule, the meaning or a clue. Return ONLY JSON.`,
    user: `Exercise (${e.type}): ${e.prompt}${e.text ? `\nSentence: ${e.text}` : ""}${e.options.length ? `\nOptions: ${e.options.join(" | ")}` : ""}\nAnswer (do not reveal): ${e.answer}`,
    schema: hintSchema,
    temperature: 0.3,
    maxTokens: 300,
    mock: () => ({ hint: "Think about the words and the grammar point of this lesson." }),
  });
  return result.data.hint;
}
