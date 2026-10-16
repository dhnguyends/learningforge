import type { CefrLevel } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getGenerator } from "@/lib/ai";
import { LEVELS, EXERCISE_TYPES, curriculumBaseLang, languageEnglishName, type Cefr } from "@/lib/polylingue/levels";
import { lessonContentSchema, normalizeLesson, outlineSchema, type LessonContent, type Outline } from "@/lib/polylingue/content";

/**
 * PolyLingue courses are written by the selected AI model, once per target
 * language, explanation language and CEFR level, and shared by every learner
 * at that level: first the outline (units and lessons), then each lesson's
 * words and exercises when it is first needed (and the next one ahead of time).
 */

const STALE_MS = 10 * 60 * 1000;
const claimable = () => ({
  OR: [{ status: { in: ["QUEUED", "FAILED"] as ("QUEUED" | "FAILED")[] } }, { status: "GENERATING" as const, updatedAt: { lt: new Date(Date.now() - STALE_MS) } }],
});

function teacherSystem(target: string, base: string, level: Cefr): string {
  const p = LEVELS[level];
  const T = languageEnglishName(target);
  const language = p.immersion
    ? `This is an immersion course: EVERYTHING the learner reads (titles, themes, instructions, explanations, tips, word meanings, ` +
      `answer options) is written in ${T} only, never in another language. Meanings are given by ${T} definitions, synonyms or paraphrases. `
    : `Explanations, instructions, lesson titles and translations are in ${languageEnglishName(base)}. `;
  return (
    `You are an expert ${T} teacher and CEFR curriculum designer. ` +
    `You write a ${T} course for level ${level} (${p.name}): ${p.canDo} ` +
    language +
    `Use natural, standard, correctly spelled ${T} with every accent. Never add citations, footnotes or source markers such as [Source 1]. ` +
    "Return ONLY one JSON object matching the requested structure, no markdown."
  );
}

/**
 * Finds or creates the shared curriculum, and starts writing its outline if
 * needed. Immersion levels (B2+) share one curriculum per language, whatever
 * the learner's own language.
 */
export async function ensureCurriculum(target: string, learnerBase: string, level: CefrLevel) {
  const base = curriculumBaseLang(target, learnerBase, level);
  const curriculum = await prisma.langCurriculum.upsert({
    where: { targetLang_baseLang_level: { targetLang: target, baseLang: base, level } },
    create: { targetLang: target, baseLang: base, level },
    update: {},
  });
  if (curriculum.status !== "READY") void generateOutline(curriculum.id).catch((err) => console.error("[polylingue] outline", curriculum.id, err));
  return curriculum;
}

/** Writes the outline (units and lessons) of a curriculum, unless another request already is. */
export async function generateOutline(curriculumId: string): Promise<void> {
  const claimed = await prisma.langCurriculum.updateMany({ where: { id: curriculumId, ...claimable() }, data: { status: "GENERATING", error: null } });
  if (claimed.count === 0) return;
  const c = await prisma.langCurriculum.findUniqueOrThrow({ where: { id: curriculumId } });
  const level = c.level as Cefr;
  const p = LEVELS[level];
  try {
    const result = await (await getGenerator()).generate({
      system: teacherSystem(c.targetLang, c.baseLang, level),
      user:
        `Write the outline of the ${level} course: exactly ${p.units} units of exactly ${p.lessonsPerUnit} lessons, from easiest to hardest.\n` +
        `Themes at this level: ${p.themes}.\nGrammar at this level: ${p.grammar}.\n` +
        (p.immersion ? `Write every title, theme, grammar point and focus in ${languageEnglishName(c.targetLang)}.\n` : "") +
        `For each unit: "title" (short), "theme", "grammar" (the grammar point it teaches). ` +
        `For each lesson: "title" (short, may include a ${languageEnglishName(c.targetLang)} key phrase) and "focus" ` +
        "(the words and the one grammar or usage point it teaches, in one sentence). Each lesson builds on the previous ones.",
      schema: outlineSchema,
      temperature: 0.4,
      maxTokens: 4000,
      mock: () => mockOutline(level),
    });
    const outline = result.data;
    await prisma.$transaction([
      prisma.langLesson.deleteMany({ where: { curriculumId, courseId: null, progress: { none: {} } } }),
      prisma.langLesson.createMany({
        data: outline.units.flatMap((u, unitIndex) =>
          u.lessons.map((l, i) => ({
            curriculumId,
            ordinal: unitIndex * 100 + i,
            unitIndex,
            unitTitle: u.title,
            title: l.title,
            focus: l.focus,
          })),
        ),
        skipDuplicates: true,
      }),
      prisma.langCurriculum.update({ where: { id: curriculumId }, data: { status: "READY", outline: outline as object, model: `${result.provider}:${result.model}` } }),
    ]);
    const first = await prisma.langLesson.findFirst({ where: { curriculumId, courseId: null }, orderBy: { ordinal: "asc" }, select: { id: true } });
    if (first) void prepareLesson(first.id).catch(() => undefined);
  } catch (err) {
    await prisma.langCurriculum.update({ where: { id: curriculumId }, data: { status: "FAILED", error: err instanceof Error ? err.message.slice(0, 500) : String(err) } });
  }
}

/** Writes a lesson's words and exercises, unless it is ready or being written. */
export async function prepareLesson(lessonId: string): Promise<void> {
  const claimed = await prisma.langLesson.updateMany({ where: { id: lessonId, ...claimable() }, data: { status: "GENERATING", error: null } });
  if (claimed.count === 0) return;
  const lesson = await prisma.langLesson.findUniqueOrThrow({ where: { id: lessonId }, include: { curriculum: true } });
  const { targetLang: target, baseLang: base } = lesson.curriculum;
  const level = lesson.curriculum.level as Cefr;
  const p = LEVELS[level];
  const earlier =
    lesson.ordinal == null
      ? []
      : await prisma.langLesson.findMany({
          where: { curriculumId: lesson.curriculumId, courseId: null, ordinal: { lt: lesson.ordinal } },
          orderBy: { ordinal: "desc" },
          take: 6,
          select: { title: true },
        });
  const mix = EXERCISE_TYPES.map((t) => `${p.mix[t]} × ${t}`).join(", ");
  const T = languageEnglishName(target);
  // Immersion (B2+): instructions and meanings in the target language itself.
  const B = p.immersion ? T : languageEnglishName(base);
  const meaning = p.immersion ? `a short ${T} definition or synonym` : `its ${B} translation`;
  try {
    const result = await (await getGenerator()).generate({
      system: teacherSystem(target, base, level),
      user:
        (lesson.sourceExcerpt
          ? // Personal lesson built on the learner's own material, at their level.
            `Write a lesson built on this ${T} text from the learner's own study material ("${lesson.unitTitle}"):\n"""\n${lesson.sourceExcerpt}\n"""\n` +
            `Take the new words from the text (the most useful ones a ${level} learner can reach); base the exercises on its sentences and ideas, ` +
            `simplified to ${level} where needed. Lesson title: "${lesson.title}".\n`
          : `Write the lesson "${lesson.title}" (unit "${lesson.unitTitle}"). Focus: ${lesson.focus}\n`) +
        (earlier.length ? `Earlier lessons: ${earlier.map((e) => e.title).reverse().join("; ")}.\n` : "") +
        `\n"intro": 2–3 sentences in ${B}: what the learner will be able to say, and one short grammar or usage tip with an example.\n` +
        `"words": exactly ${p.newWords} new ${T} words or short phrases for this lesson, each with "translation" (${meaning}), ` +
        `"example" (a ${T} sentence of at most ${p.maxSentenceWords} words), ` +
        `"exampleTranslation" (${p.immersion ? `a simpler ${T} paraphrase of the example` : B}), "partOfSpeech".\n` +
        `"exercises": exactly ${p.exercises} exercises in this mix: ${mix}. Use the lesson's words and earlier ${level} material only. ` +
        `${T} sentences have at most ${p.maxSentenceWords} words. Every exercise has all fields (use "" or [] when unused):\n` +
        `- choice: "prompt" asks in ${B} for the meaning of a ${T} word or phrase, or which ${T} phrase fits a situation; "options" = 4 options ` +
        `(the right one and 3 plausible wrong ones); "answer" = the exact text of the right option; "audio" = the ${T} word or phrase.\n` +
        `- listen: "audio" and "text" = a ${T} sentence; "prompt" = "What does it mean?" in ${B}; "options" = 4 ${p.immersion ? `${T} paraphrases` : `${B} meanings`}; "answer" = the right one.\n` +
        `- match: "pairs" = 4 or 5 pairs {"left": ${T} word, "right": ${meaning}}; "prompt" = "Match the pairs" in ${B}.\n` +
        `- order: "answer" = a correct ${T} sentence of 3 or more words; "prompt" = its ${B} meaning, introduced as "Put the words in order:" in ${B}.\n` +
        `- cloze: "text" = a ${T} sentence with exactly one missing word written as {{word}}; "answer" = that word; "prompt" = an instruction in ${B} ` +
        `with the sentence's meaning; "options" = 3 or 4 choices at A1–A2, [] from B1 (the learner types it).\n` +
        (p.immersion
          ? `- translate (immersion: a rewriting task, no other language): "prompt" = an instruction in ${T} to rewrite a given ${T} sentence ` +
            `(change the register, the voice, the tense, use a given connector or a more precise word), followed by that sentence; ` +
            `"answer" = the best rewriting; "accepted" = up to 4 other correct rewritings; "audio" = "".\n`
          : `- translate: "prompt" = "Translate:" in ${B} followed by the sentence; at A1 translate from ${T} into ${B}, from A2 mostly from ${B} into ${T}; ` +
            `"answer" = the best translation; "accepted" = up to 4 other correct translations; "audio" = the ${T} sentence when the source is ${T}, else "".\n`) +
        `- "explanation" for every exercise: one short line in ${B} (the meaning or the rule).`,
      schema: lessonContentSchema,
      temperature: 0.5,
      maxTokens: 7000,
      mock: () => mockLesson(target, lesson.title, p.exercises),
    });
    const content = normalizeLesson(result.data);
    await prisma.langLesson.update({ where: { id: lessonId }, data: { status: "READY", content: content as object, model: `${result.provider}:${result.model}` } });
  } catch (err) {
    await prisma.langLesson.update({ where: { id: lessonId }, data: { status: "FAILED", error: err instanceof Error ? err.message.slice(0, 500) : String(err) } });
  }
}

/** Starts writing the lesson after this one, so it is ready when the learner gets there. */
export async function prefetchNext(lessonId: string): Promise<void> {
  const lesson = await prisma.langLesson.findUnique({ where: { id: lessonId }, select: { curriculumId: true, ordinal: true } });
  if (!lesson || lesson.ordinal == null) return; // personal lessons have no "next"
  const next = await prisma.langLesson.findFirst({
    where: { curriculumId: lesson.curriculumId, courseId: null, ordinal: { gt: lesson.ordinal } },
    orderBy: { ordinal: "asc" },
    select: { id: true, status: true },
  });
  if (next && next.status !== "READY") void prepareLesson(next.id).catch(() => undefined);
}

// ------------------------------------------------------------ offline mocks

function mockOutline(level: Cefr): Outline {
  const p = LEVELS[level];
  return {
    units: Array.from({ length: p.units }, (_, u) => ({
      title: `Unit ${u + 1}`,
      theme: p.themes.split(", ")[u] ?? "review",
      grammar: p.grammar.split(", ")[u] ?? "review",
      lessons: Array.from({ length: p.lessonsPerUnit }, (_, l) => ({ title: `Lesson ${u + 1}.${l + 1}`, focus: `Words and phrases ${u + 1}.${l + 1}` })),
    })),
  };
}

/** Playable offline lesson: "[es] word 1" = "word 1", one exercise of each type. */
function mockLesson(target: string, title: string, count: number): LessonContent {
  const t = (s: string) => `${target} ${s}`;
  const words = Array.from({ length: 5 }, (_, i) => ({
    term: t(`word${i + 1}`),
    translation: `word${i + 1}`,
    example: t(`I use word${i + 1} here`),
    exampleTranslation: `I use word${i + 1} here`,
    partOfSpeech: "noun",
  }));
  const base = [
    { type: "choice", prompt: `What does "${t("word1")}" mean?`, text: "", answer: "word1", accepted: [], options: ["word1", "word2", "word3", "word4"], pairs: [], explanation: `${t("word1")} = word1`, audio: t("word1") },
    { type: "listen", prompt: "What does it mean?", text: t("good morning"), answer: "good morning", accepted: [], options: ["good morning", "good night", "thank you", "goodbye"], pairs: [], explanation: "A greeting.", audio: t("good morning") },
    { type: "match", prompt: "Match the pairs", text: "", answer: "", accepted: [], options: [], pairs: words.slice(0, 4).map((w) => ({ left: w.term, right: w.translation })), explanation: "", audio: "" },
    { type: "order", prompt: "Put the words in order: I like coffee", text: "", answer: t("I like coffee"), accepted: [], options: [], pairs: [], explanation: "Subject, verb, object.", audio: "" },
    { type: "cloze", prompt: "Fill in the blank (I drink water)", text: `${t("I drink")} {{water}}`, answer: "water", accepted: [], options: ["water", "bread", "milk"], pairs: [], explanation: "water", audio: "" },
    { type: "translate", prompt: "Translate: thank you", text: "", answer: t("thanks"), accepted: [t("thank you")], options: [], pairs: [], explanation: "Polite thanks.", audio: "" },
  ] as LessonContent["exercises"];
  return {
    intro: `${title}: say hello and thank you. Tip: greetings change with the time of day.`,
    words,
    exercises: Array.from({ length: Math.max(6, count) }, (_, i) => base[i % base.length]),
  };
}
