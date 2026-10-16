import type { CefrLevel, LanguageCourse } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError, notFound } from "@/lib/api";
import { DEFAULT_ALGORITHM, getScheduler, type Grade } from "@/lib/srs/fsrs";
import { ensureCurriculum, prefetchNext, prepareLesson } from "@/lib/polylingue/curriculum";
import { exerciseForPlayer, type LessonContent } from "@/lib/polylingue/content";
import { isImmersion, type Cefr } from "@/lib/polylingue/levels";
import { judgeRewrite, writeHint } from "@/lib/polylingue/practice-gen";
import { foldAccents, normalizeAnswer } from "@/lib/polylingue/check";
import { rateLimit } from "@/lib/rate-limit";
import { rateLimited } from "@/lib/api";
import { checkAnswer, type Verdict } from "@/lib/polylingue/check";
import { EXERCISE_TYPES } from "@/lib/polylingue/levels";
import { MODE_WINDOW, accuracy, adaptExercise, modeFor, type Mode } from "@/lib/polylingue/adapt";
import { buildWeakSession, checkWeak, pickWeakCards, type WeakKind } from "@/lib/polylingue/weak";
import { XP, answerXp, currentStreak, dayKey, lessonBonus, nextStreak, previousDay } from "@/lib/polylingue/progress";

/** Learner-side PolyLingue operations. Every function checks the course belongs to the user. */

export async function ownCourse(userId: string, courseId: string): Promise<LanguageCourse> {
  const course = await prisma.languageCourse.findUnique({ where: { id: courseId } });
  if (!course || course.userId !== userId) throw notFound("Course");
  return course;
}

/** Adds XP, time, lessons or reviews to today, and moves the streak. */
export async function addActivity(course: LanguageCourse, add: { xp?: number; seconds?: number; lessons?: number; reviews?: number }) {
  const today = dayKey(new Date(), course.timeZone);
  const active = (add.xp ?? 0) > 0 || (add.lessons ?? 0) > 0 || (add.reviews ?? 0) > 0;
  const streak = active ? nextStreak(course.lastActiveDay, today, course.streak) : course.streak;
  await prisma.$transaction([
    prisma.langDailyActivity.upsert({
      where: { courseId_day: { courseId: course.id, day: today } },
      create: { courseId: course.id, day: today, xp: add.xp ?? 0, seconds: add.seconds ?? 0, lessons: add.lessons ?? 0, reviews: add.reviews ?? 0 },
      update: {
        xp: { increment: add.xp ?? 0 },
        seconds: { increment: add.seconds ?? 0 },
        lessons: { increment: add.lessons ?? 0 },
        reviews: { increment: add.reviews ?? 0 },
      },
    }),
    prisma.languageCourse.update({
      where: { id: course.id },
      data: {
        xp: { increment: add.xp ?? 0 },
        ...(active ? { streak, bestStreak: Math.max(course.bestStreak, streak), lastActiveDay: today } : {}),
      },
    }),
  ]);
}

/** Summary shown on cards and the course header. */
async function summary(course: LanguageCourse & { curriculum: { status: string; error: string | null } }) {
  const today = dayKey(new Date(), course.timeZone);
  const [day, due, words, next, lowLesson, weakCount] = await Promise.all([
    prisma.langDailyActivity.findUnique({ where: { courseId_day: { courseId: course.id, day: today } } }),
    prisma.langCard.count({ where: { courseId: course.id, dueAt: { lte: new Date() } } }),
    prisma.langCard.count({ where: { courseId: course.id } }),
    nextLesson(course),
    prisma.langLessonProgress.findFirst({
      where: { courseId: course.id, bestScore: { lt: 60 }, completedAt: { not: null }, lesson: { curriculumId: course.curriculumId } },
      orderBy: { updatedAt: "desc" },
      select: { lessonId: true, bestScore: true, lesson: { select: { title: true } } },
    }),
    prisma.langCard.count({ where: { courseId: course.id, lapses: { gt: 0 } } }),
  ]);
  // What to do next, always within the chosen level.
  const recommendation = lowLesson
    ? { kind: "redo" as const, lessonId: lowLesson.lessonId, title: lowLesson.lesson.title, score: lowLesson.bestScore }
    : weakCount >= 3
      ? { kind: "weak" as const, count: weakCount }
      : due >= 10
        ? { kind: "review" as const, count: due }
        : null;
  const minutes = Math.round(((day?.seconds ?? 0) / 60) * 10) / 10;
  return {
    id: course.id,
    targetLang: course.targetLang,
    baseLang: course.baseLang,
    level: course.level,
    dailyGoalMinutes: course.dailyGoalMinutes,
    timeZone: course.timeZone,
    xp: course.xp,
    streak: currentStreak(course.lastActiveDay, today, course.streak),
    bestStreak: course.bestStreak,
    today: { minutes, xp: day?.xp ?? 0, lessons: day?.lessons ?? 0, reviews: day?.reviews ?? 0, goalMet: minutes >= course.dailyGoalMinutes },
    dueWords: due,
    words,
    curriculum: { status: course.curriculum.status, error: course.curriculum.error },
    nextLesson: next,
    recommendation,
  };
}
export type CourseSummary = Awaited<ReturnType<typeof summary>>;

async function nextLesson(course: LanguageCourse) {
  const lesson = await prisma.langLesson.findFirst({
    where: { curriculumId: course.curriculumId, courseId: null, progress: { none: { courseId: course.id, completedAt: { not: null } } } },
    orderBy: { ordinal: "asc" },
    select: { id: true, title: true, unitTitle: true },
  });
  return lesson;
}

export async function listCourses(userId: string): Promise<CourseSummary[]> {
  const courses = await prisma.languageCourse.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    include: { curriculum: { select: { status: true, error: true } } },
  });
  return Promise.all(courses.map(summary));
}

/** Starts (or re-levels) a language: the shared curriculum for this level is found or written. */
export async function startCourse(
  userId: string,
  input: { level: CefrLevel; targetLang: string; baseLang: string; dailyGoalMinutes: number; timeZone: string },
): Promise<CourseSummary> {
  if (input.targetLang === input.baseLang && !isImmersion(input.level)) {
    throw new ApiError(400, "Choose a language to learn that differs from the explanation language", "bad_request");
  }
  const curriculum = await ensureCurriculum(input.targetLang, input.baseLang, input.level);
  const course = await prisma.languageCourse.upsert({
    where: { userId_targetLang: { userId, targetLang: input.targetLang } },
    create: { userId, ...input, curriculumId: curriculum.id },
    update: { level: input.level, baseLang: input.baseLang, dailyGoalMinutes: input.dailyGoalMinutes, timeZone: input.timeZone, curriculumId: curriculum.id },
    include: { curriculum: { select: { status: true, error: true } } },
  });
  return summary(course);
}

export async function updateCourse(
  userId: string,
  courseId: string,
  input: { level?: CefrLevel; baseLang?: string; dailyGoalMinutes?: number; timeZone?: string },
): Promise<CourseSummary> {
  const course = await ownCourse(userId, courseId);
  let curriculumId = course.curriculumId;
  const level = input.level ?? course.level;
  const baseLang = input.baseLang ?? course.baseLang;
  if (level !== course.level || baseLang !== course.baseLang) {
    if (baseLang === course.targetLang && !isImmersion(level)) {
      throw new ApiError(400, "The explanation language must differ from the language you learn", "bad_request");
    }
    curriculumId = (await ensureCurriculum(course.targetLang, baseLang, level)).id;
  }
  const updated = await prisma.languageCourse.update({
    where: { id: courseId },
    data: { level, baseLang, curriculumId, dailyGoalMinutes: input.dailyGoalMinutes, timeZone: input.timeZone },
    include: { curriculum: { select: { status: true, error: true } } },
  });
  return summary(updated);
}

export async function deleteCourse(userId: string, courseId: string): Promise<void> {
  await ownCourse(userId, courseId);
  await prisma.languageCourse.delete({ where: { id: courseId } });
}

/** Course page: summary, units and lessons with the learner's progress. */
export async function courseDetail(userId: string, courseId: string) {
  const course = await prisma.languageCourse.findUnique({ where: { id: courseId }, include: { curriculum: true } });
  if (!course || course.userId !== userId) throw notFound("Course");
  const [lessons, progress, own] = await Promise.all([
    prisma.langLesson.findMany({
      where: { curriculumId: course.curriculumId, courseId: null },
      orderBy: { ordinal: "asc" },
      select: { id: true, unitIndex: true, unitTitle: true, title: true, focus: true, status: true },
    }),
    prisma.langLessonProgress.findMany({ where: { courseId } }),
    prisma.langLesson.findMany({
      where: { curriculumId: course.curriculumId, courseId },
      orderBy: { createdAt: "desc" },
      select: { id: true, unitTitle: true, title: true, status: true, sourceId: true },
    }),
  ]);
  const byLesson = new Map(progress.map((p) => [p.lessonId, p]));
  const outline = (course.curriculum.outline as { units?: { title: string; theme: string; grammar: string }[] }) ?? {};
  const units = (outline.units ?? []).map((u, unitIndex) => ({
    title: u.title,
    theme: u.theme,
    grammar: u.grammar,
    lessons: lessons
      .filter((l) => l.unitIndex === unitIndex)
      .map((l) => ({
        id: l.id,
        title: l.title,
        focus: l.focus,
        ready: l.status === "READY",
        completed: Boolean(byLesson.get(l.id)?.completedAt),
        bestScore: byLesson.get(l.id)?.bestScore ?? 0,
      })),
  }));
  const sourceLessons = own.map((l) => ({
    id: l.id,
    title: l.title,
    source: l.unitTitle,
    ready: l.status === "READY",
    failed: l.status === "FAILED",
    completed: Boolean(byLesson.get(l.id)?.completedAt),
    bestScore: byLesson.get(l.id)?.bestScore ?? 0,
  }));
  return { ...(await summary(course)), units, sourceLessons };
}

/** The learner's recent lesson answers (most recent first), for the adaptive mode. */
async function recentLessonVerdicts(courseId: string): Promise<Verdict[]> {
  const rows = await prisma.langExerciseAttempt.findMany({
    where: { courseId, type: { in: [...EXERCISE_TYPES] } },
    orderBy: { createdAt: "desc" },
    take: MODE_WINDOW,
    select: { verdict: true },
  });
  return rows.map((r) => r.verdict as Verdict);
}

/** Support, standard or challenge, from the last answers; always within the chosen level. */
export async function courseMode(courseId: string): Promise<{ mode: Mode; accuracy: number | null; answers: number }> {
  const verdicts = await recentLessonVerdicts(courseId);
  const a = accuracy(verdicts);
  return { mode: modeFor(verdicts), accuracy: a === null ? null : Math.round(a * 100), answers: verdicts.length };
}

/** A lesson for the player (answers stay on the server), or its preparation status. */
export async function lessonForPlayer(userId: string, courseId: string, lessonId: string) {
  const course = await ownCourse(userId, courseId);
  const lesson = await prisma.langLesson.findFirst({ where: { id: lessonId, curriculumId: course.curriculumId, OR: [{ courseId: null }, { courseId: course.id }] } });
  if (!lesson) throw notFound("Lesson");
  if (lesson.status !== "READY" || !lesson.content) {
    void prepareLesson(lesson.id).catch(() => undefined);
    return { id: lesson.id, title: lesson.title, unitTitle: lesson.unitTitle, status: lesson.status, error: lesson.error, mode: "normal" as Mode, content: null };
  }
  void prefetchNext(lesson.id).catch(() => undefined);
  const content = lesson.content as unknown as LessonContent;
  const { mode } = await courseMode(course.id);
  return {
    id: lesson.id,
    title: lesson.title,
    unitTitle: lesson.unitTitle,
    status: lesson.status,
    error: null,
    mode,
    content: {
      intro: content.intro,
      words: content.words,
      exercises: content.exercises.map((e, i) => ({
        ...adaptExercise(exerciseForPlayer(e), e, mode, content.exercises, i + 1),
        glossable: glossableWords(e, content.words),
      })),
    },
  };
}

async function readyLesson(course: LanguageCourse, lessonId: string): Promise<LessonContent> {
  const lesson = await prisma.langLesson.findFirst({ where: { id: lessonId, curriculumId: course.curriculumId, OR: [{ courseId: null }, { courseId: course.id }] } });
  if (!lesson) throw notFound("Lesson");
  if (lesson.status !== "READY" || !lesson.content) throw new ApiError(409, "This lesson is not ready yet", "not_ready");
  return lesson.content as unknown as LessonContent;
}

/** Instant correction of one answer, with XP. */
export async function answerExercise(userId: string, courseId: string, lessonId: string, input: { index: number; answer: string; retry: boolean; hinted?: boolean }) {
  const course = await ownCourse(userId, courseId);
  const content = await readyLesson(course, lessonId);
  const exercise = content.exercises[input.index];
  if (!exercise) throw notFound("Exercise");
  let result = checkAnswer(exercise, input.answer);
  // Immersion rewriting has many right answers: let the model judge one that is not listed.
  if (result.verdict === "wrong" && exercise.type === "translate" && isImmersion(course.level) && input.answer.trim()) {
    try {
      const judged = await judgeRewrite({ target: course.targetLang, level: course.level as Cefr, prompt: exercise.prompt, expected: exercise.answer, given: input.answer });
      if (judged.correct) result = { verdict: "correct", expected: exercise.answer, note: judged.note || undefined };
    } catch {
      /* keep the strict verdict when the model is unavailable */
    }
  }
  // A hint halves the exercise's XP.
  const xp = Math.floor(answerXp(result.verdict, input.retry) / (input.hinted ? 2 : 1));
  await prisma.langExerciseAttempt.create({
    data: { courseId, lessonId, exerciseIndex: input.index, type: exercise.type, answer: input.answer.slice(0, 500), verdict: result.verdict, xp },
  });
  if (xp > 0) await addActivity(course, { xp });
  return { ...result, xp, explanation: exercise.explanation, audio: exercise.audio || null };
}

/** Lesson finished: score, bonus XP, time, and its words go into review. */
export async function completeLesson(userId: string, courseId: string, lessonId: string, input: { firstTryCorrect: number; total: number; seconds: number }) {
  const course = await ownCourse(userId, courseId);
  const content = await readyLesson(course, lessonId);
  const total = Math.max(1, Math.min(input.total, content.exercises.length));
  const score = Math.round((Math.min(input.firstTryCorrect, total) / total) * 100);
  const bonus = lessonBonus(score);
  const seconds = Math.max(0, Math.min(Math.round(input.seconds), 60 * 60));
  const previous = await prisma.langLessonProgress.findUnique({ where: { courseId_lessonId: { courseId, lessonId } } });
  await prisma.langLessonProgress.upsert({
    where: { courseId_lessonId: { courseId, lessonId } },
    create: { courseId, lessonId, bestScore: score, runs: 1, xp: bonus, completedAt: new Date() },
    update: { bestScore: Math.max(previous?.bestScore ?? 0, score), runs: { increment: 1 }, xp: { increment: bonus }, completedAt: previous?.completedAt ?? new Date() },
  });
  const added = await prisma.langCard.createMany({
    data: content.words.map((w) => ({
      courseId,
      term: w.term,
      translation: w.translation,
      example: w.example || null,
      exampleTranslation: w.exampleTranslation || null,
      partOfSpeech: w.partOfSpeech || null,
      lessonId,
    })),
    skipDuplicates: true,
  });
  await addActivity(course, { xp: bonus, seconds, lessons: 1 });
  return { score, bonusXp: bonus, newWords: added.count };
}

/** Words due for review (spaced repetition), oldest due first. */
export async function dueCards(userId: string, courseId: string, limit = 20) {
  await ownCourse(userId, courseId);
  return prisma.langCard.findMany({
    where: { courseId, dueAt: { lte: new Date() } },
    orderBy: [{ dueAt: "asc" }],
    take: limit,
    select: { id: true, term: true, translation: true, example: true, exampleTranslation: true, partOfSpeech: true, state: true, reps: true },
  });
}

export async function gradeCard(userId: string, courseId: string, cardId: string, input: { grade: Grade; seconds: number }) {
  const course = await ownCourse(userId, courseId);
  const card = await prisma.langCard.findFirst({ where: { id: cardId, courseId } });
  if (!card) throw notFound("Word");
  const outcome = getScheduler(DEFAULT_ALGORITHM).review(card, input.grade, new Date());
  await prisma.langCard.update({
    where: { id: cardId },
    data: {
      state: outcome.state,
      stability: outcome.stability,
      difficulty: outcome.difficulty,
      reps: outcome.reps,
      lapses: outcome.lapses,
      dueAt: outcome.dueAt,
      lastReviewedAt: new Date(),
    },
  });
  const xp = input.grade >= 3 ? XP.reviewGood : XP.reviewAgain;
  await addActivity(course, { xp, seconds: Math.max(0, Math.min(Math.round(input.seconds), 300)), reviews: 1 });
  return { dueAt: outcome.dueAt, xp };
}

/** Progress page: totals, the last 35 days, and the words to strengthen. */
export async function progressStats(userId: string, courseId: string) {
  const course = await ownCourse(userId, courseId);
  const today = dayKey(new Date(), course.timeZone);
  const days: string[] = [today];
  while (days.length < 35) days.push(previousDay(days[days.length - 1]));
  const [activity, lessonsDone, words, mastered, weak, attempts] = await Promise.all([
    prisma.langDailyActivity.findMany({ where: { courseId, day: { in: days } } }),
    prisma.langLessonProgress.count({ where: { courseId, completedAt: { not: null } } }),
    prisma.langCard.count({ where: { courseId } }),
    prisma.langCard.count({ where: { courseId, state: "REVIEW", stability: { gte: 21 } } }),
    prisma.langCard.findMany({
      where: { courseId, OR: [{ lapses: { gt: 0 } }, { difficulty: { gte: 7 } }] },
      orderBy: [{ lapses: "desc" }, { difficulty: "desc" }],
      take: 12,
      select: { id: true, term: true, translation: true, lapses: true },
    }),
    prisma.langExerciseAttempt.groupBy({ by: ["verdict"], where: { courseId }, _count: true }),
  ]);
  const [byType, mode] = await Promise.all([
    prisma.langExerciseAttempt.groupBy({ by: ["type", "verdict"], where: { courseId }, _count: true }),
    courseMode(courseId),
  ]);
  const skillOf = (type: string) =>
    (EXERCISE_TYPES as readonly string[]).includes(type)
      ? "Lessons"
      : type.startsWith("reading")
        ? "Reading"
        : type.startsWith("listening")
          ? "Listening"
          : type.startsWith("writing")
            ? "Writing"
            : type.startsWith("speaking")
              ? "Speaking"
              : type.startsWith("weak")
                ? "Weak words"
                : null;
  const skillTotals = new Map<string, { points: number; answers: number }>();
  for (const row of byType) {
    const skill = skillOf(row.type);
    if (!skill) continue;
    const t = skillTotals.get(skill) ?? { points: 0, answers: 0 };
    t.points += row._count * (row.verdict === "correct" ? 1 : row.verdict === "almost" ? 0.5 : 0);
    t.answers += row._count;
    skillTotals.set(skill, t);
  }
  const skills = ["Lessons", "Reading", "Listening", "Writing", "Speaking", "Weak words"].map((name) => {
    const t = skillTotals.get(name);
    return { name, answers: t?.answers ?? 0, accuracy: t?.answers ? Math.round((t.points / t.answers) * 100) : null };
  });
  const byDay = new Map(activity.map((a) => [a.day, a]));
  const counts = Object.fromEntries(attempts.map((a) => [a.verdict, a._count])) as Record<string, number>;
  const answered = (counts.correct ?? 0) + (counts.almost ?? 0) + (counts.wrong ?? 0);
  return {
    xp: course.xp,
    streak: currentStreak(course.lastActiveDay, today, course.streak),
    bestStreak: course.bestStreak,
    lessonsDone,
    words,
    mastered,
    accuracy: answered ? Math.round((((counts.correct ?? 0) + (counts.almost ?? 0) * 0.5) / answered) * 100) : null,
    activeDays: activity.filter((a) => a.xp > 0).length,
    days: days
      .slice()
      .reverse()
      .map((d) => ({ day: d, xp: byDay.get(d)?.xp ?? 0, minutes: Math.round((byDay.get(d)?.seconds ?? 0) / 60) })),
    weakWords: weak,
    dailyGoalMinutes: course.dailyGoalMinutes,
    skills,
    mode,
  };
}


// ------------------------------------------------------- weak-word practice

/** A session on the learner's weakest words (needs at least 4 words). */
export async function weakWordsSession(userId: string, courseId: string) {
  await ownCourse(userId, courseId);
  const all = await prisma.langCard.findMany({
    where: { courseId },
    select: { id: true, term: true, translation: true, lapses: true, difficulty: true, stability: true, reps: true },
  });
  if (all.length < 4) return { enough: false, exercises: [] };
  const weak = pickWeakCards(all, 10);
  return { enough: true, exercises: buildWeakSession(weak, all, Date.now() % 1000) };
}

/** Checks one weak-word answer, grades the word's card (FSRS) and gives XP. */
export async function answerWeakWord(userId: string, courseId: string, input: { cardId: string; kind: WeakKind; answer: string }) {
  const course = await ownCourse(userId, courseId);
  const card = await prisma.langCard.findFirst({ where: { id: input.cardId, courseId } });
  if (!card) throw notFound("Word");
  const result = checkWeak(card, input.kind, input.answer);
  const grade: Grade = result.verdict === "correct" ? 3 : result.verdict === "almost" ? 2 : 1;
  const outcome = getScheduler(DEFAULT_ALGORITHM).review(card, grade, new Date());
  await prisma.langCard.update({
    where: { id: card.id },
    data: { state: outcome.state, stability: outcome.stability, difficulty: outcome.difficulty, reps: outcome.reps, lapses: outcome.lapses, dueAt: outcome.dueAt, lastReviewedAt: new Date() },
  });
  const xp = answerXp(result.verdict, false);
  await prisma.langExerciseAttempt.create({
    data: { courseId, lessonId: "weak-words", exerciseIndex: 0, type: `weak-${input.kind}`, answer: input.answer.slice(0, 500), verdict: result.verdict, xp },
  });
  if (xp > 0) await addActivity(course, { xp, reviews: 1 });
  return { ...result, xp, term: card.term, translation: card.translation };
}

// ------------------------------------------------------------------- hints

/** True when a hint would give the answer away (the answer, or most of its words, appear in it). */
export function hintRevealsAnswer(hint: string, answer: string): boolean {
  const h = foldAccents(normalizeAnswer(hint));
  const a = foldAccents(normalizeAnswer(answer));
  if (a.length >= 3 && h.includes(a)) return true;
  const words = a.split(" ").filter((w) => w.length > 3);
  return words.length > 0 && words.filter((w) => h.split(" ").includes(w)).length / words.length > 0.5;
}

/** A hint for one exercise, written once by the model and kept in the lesson for every learner. */
export async function hintForExercise(userId: string, courseId: string, lessonId: string, index: number) {
  const course = await ownCourse(userId, courseId);
  const lesson = await prisma.langLesson.findFirst({ where: { id: lessonId, curriculumId: course.curriculumId, OR: [{ courseId: null }, { courseId: course.id }] }, include: { curriculum: true } });
  if (!lesson?.content || lesson.status !== "READY") throw notFound("Lesson");
  const content = lesson.content as unknown as LessonContent & { hints?: Record<string, string> };
  const exercise = content.exercises[index];
  if (!exercise) throw notFound("Exercise");
  const cached = content.hints?.[String(index)];
  if (cached) return { hint: cached };
  const limit = rateLimit(`polylingue-hint:${userId}`, 60);
  if (!limit.allowed) throw rateLimited(limit.retryAfterSec);
  let hint = await writeHint({ target: lesson.curriculum.targetLang, base: lesson.curriculum.baseLang, level: lesson.curriculum.level as Cefr, exercise });
  if (hintRevealsAnswer(hint, exercise.answer)) {
    hint = exercise.explanation && !hintRevealsAnswer(exercise.explanation, exercise.answer) ? exercise.explanation : "Look again at the new words and the tip of this lesson.";
  }
  const fresh = await prisma.langLesson.findUniqueOrThrow({ where: { id: lessonId }, select: { content: true } });
  const current = fresh.content as unknown as LessonContent & { hints?: Record<string, string> };
  await prisma.langLesson.update({ where: { id: lessonId }, data: { content: { ...current, hints: { ...(current.hints ?? {}), [String(index)]: hint } } as object } });
  return { hint };
}

/**
 * Lesson words the player may gloss (tap for the meaning) in one exercise:
 * never one whose form or meaning overlaps the answer, which would give it away.
 */
export function glossableWords(e: { answer: string; accepted: string[] }, words: { term: string; translation: string }[]): string[] {
  const answers = [e.answer, ...e.accepted].map((a) => foldAccents(normalizeAnswer(a))).filter(Boolean);
  const overlaps = (x: string) => {
    const v = foldAccents(normalizeAnswer(x));
    return v.length > 0 && answers.some((a) => a.includes(v) || v.includes(a));
  };
  return words.filter((w) => !overlaps(w.term) && !overlaps(w.translation)).map((w) => w.term);
}
