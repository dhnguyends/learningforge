import { prisma } from "@/lib/db";
import { keepSpokenAnswer } from "@/lib/polylingue/recordings";
import { ApiError, notFound, rateLimited } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { getTranscriber } from "@/lib/transcription";
import type { Cefr } from "@/lib/polylingue/levels";
import { checkText } from "@/lib/polylingue/check";
import { answerXp, lessonBonus } from "@/lib/polylingue/progress";
import { addActivity, ownCourse } from "@/lib/polylingue/service";
import { correctText, ensurePractices, preparePractice } from "@/lib/polylingue/practice-gen";
import {
  READING_FORMATS,
  READING_TOPICS,
  type ReadingFormat,
  type ReadingTopic,
  practiceForPlayer,
  scoreSpoken,
  type ListeningContent,
  type PracticeContent,
  type ReadingContent,
  type Skill,
  type SpeakingContent,
  type WritingContent,
} from "@/lib/polylingue/practice";

/** Learner-side multi-skill practice (reading, listening, writing, speaking). */

async function practiceOf(userId: string, courseId: string, practiceId: string) {
  const course = await ownCourse(userId, courseId);
  // Shared unit practice of the learner's course, or one of their own personal practices.
  const practice = await prisma.langPractice.findFirst({
    where: { id: practiceId, curriculumId: course.curriculumId, OR: [{ courseId: null }, { courseId: course.id }] },
    include: { curriculum: true },
  });
  if (!practice) throw notFound("Practice");
  return { course, practice };
}

async function readyContent(userId: string, courseId: string, practiceId: string) {
  const { course, practice } = await practiceOf(userId, courseId, practiceId);
  if (practice.status !== "READY" || !practice.content) throw new ApiError(409, "This practice is not ready yet", "not_ready");
  return { course, practice, content: practice.content as unknown as PracticeContent };
}

/** The practices of one skill (one per unit of the course, then the learner's own), with their best score. */
export async function listPractices(userId: string, courseId: string, skill: Skill) {
  const course = await ownCourse(userId, courseId);
  const curriculum = await prisma.langCurriculum.findUniqueOrThrow({ where: { id: course.curriculumId } });
  if (curriculum.status !== "READY") return { ready: false, practices: [], personal: [] };
  const rows = await ensurePractices(course.curriculumId, skill);
  const own = await prisma.langPractice.findMany({
    where: { curriculumId: course.curriculumId, skill, courseId: course.id },
    orderBy: { createdAt: "desc" },
  });
  const progress = await prisma.langPracticeProgress.findMany({ where: { courseId, practiceId: { in: [...rows, ...own].map((r) => r.id) } } });
  const byId = new Map(progress.map((p) => [p.practiceId, p]));
  const units = (curriculum.outline as { units?: { title: string; theme: string }[] })?.units ?? [];
  const item = (r: (typeof rows)[number]) => ({
    id: r.id,
    unitIndex: r.unitIndex ?? -1,
    unitTitle: r.unitIndex == null ? r.title : (units[r.unitIndex]?.title ?? r.title),
    theme: r.unitIndex == null ? `${READING_FORMATS.find((f) => f.id === r.format)?.label ?? ""} · ${r.topic ?? ""}` : (units[r.unitIndex]?.theme ?? ""),
    title: r.title,
    format: r.format,
    topic: r.topic,
    ready: r.status === "READY",
    failed: r.status === "FAILED",
    completed: Boolean(byId.get(r.id)?.completedAt),
    bestScore: byId.get(r.id)?.bestScore ?? 0,
  });
  return { ready: true, practices: rows.map(item), personal: own.map(item) };
}

/**
 * A personal reading in the style of a kind of source (newspaper, magazine,
 * novel, textbook, research thesis) on a subject the learner picks — at their
 * course level. Written in the background; the learner opens it right away.
 */
export async function createPersonalReading(userId: string, courseId: string, input: { format: ReadingFormat; topic: ReadingTopic; customTopic?: string }) {
  const course = await ownCourse(userId, courseId);
  const curriculum = await prisma.langCurriculum.findUniqueOrThrow({ where: { id: course.curriculumId } });
  if (curriculum.status !== "READY") throw new ApiError(409, "Your course is still being written", "not_ready");
  const limit = rateLimit(`polylingue-reading:${userId}`, 20);
  if (!limit.allowed) throw rateLimited(limit.retryAfterSec);
  const topic = input.topic === "custom" ? (input.customTopic ?? "").trim() : (READING_TOPICS.find((t) => t.id === input.topic)?.label ?? input.topic);
  if (!topic) throw new ApiError(400, "Write your topic", "bad_request");
  const format = READING_FORMATS.find((f) => f.id === input.format)!;
  const practice = await prisma.langPractice.create({
    data: {
      curriculumId: course.curriculumId,
      skill: "READING",
      courseId: course.id,
      format: format.id,
      topic: topic.slice(0, 120),
      title: `${format.label}: ${topic}`.slice(0, 120),
    },
  });
  void preparePractice(practice.id).catch(() => undefined);
  return { id: practice.id };
}

/** A practice for the player (answers hidden), or its preparation status. */
export async function practiceForLearner(userId: string, courseId: string, practiceId: string) {
  const { practice } = await practiceOf(userId, courseId, practiceId);
  if (practice.status !== "READY" || !practice.content) {
    void preparePractice(practice.id).catch(() => undefined);
    return { id: practice.id, skill: practice.skill, title: practice.title, status: practice.status, error: practice.error, content: null };
  }
  return {
    id: practice.id,
    skill: practice.skill,
    title: practice.title,
    status: practice.status,
    error: null,
    content: practiceForPlayer(practice.skill, practice.content as unknown as PracticeContent),
  };
}

/** Text of a listening sentence, for its audio clip (never sent as text before the answer). */
export async function listeningSentence(userId: string, courseId: string, practiceId: string, part: "dictation" | "passage", index: number) {
  const { course, practice, content } = await readyContent(userId, courseId, practiceId);
  if (practice.skill !== "LISTENING") throw notFound("Audio");
  const list = (content as ListeningContent)[part];
  const text = list[index];
  if (!text) throw notFound("Sentence");
  // Dialogue lines start with "Name:"; the voice reads only the words.
  return { lang: course.targetLang, text: text.replace(/^[^:]{1,24}:\s*/, "") };
}

/** Reading / listening question or dictation sentence: instant correction with XP. */
export async function answerPractice(userId: string, courseId: string, practiceId: string, input: { part: "question" | "dictation"; index: number; answer: string }) {
  const { course, practice, content } = await readyContent(userId, courseId, practiceId);
  if (practice.skill !== "READING" && practice.skill !== "LISTENING") throw new ApiError(400, "This practice has no questions", "bad_request");
  let verdict: "correct" | "almost" | "wrong";
  let expected: string;
  let explanation = "";
  let note: string | undefined;
  if (input.part === "dictation") {
    if (practice.skill !== "LISTENING") throw notFound("Sentence");
    const sentence = (content as ListeningContent).dictation[input.index];
    if (!sentence) throw notFound("Sentence");
    const r = checkText(input.answer, sentence);
    ({ verdict, expected, note } = r);
  } else {
    const q = (content as ReadingContent | ListeningContent).questions[input.index];
    if (!q) throw notFound("Question");
    verdict = input.answer.trim() === q.answer ? "correct" : "wrong";
    expected = q.answer;
    explanation = q.explanation;
  }
  const xp = answerXp(verdict, false);
  await prisma.langExerciseAttempt.create({
    data: { courseId, lessonId: practiceId, exerciseIndex: input.index, type: `${practice.skill.toLowerCase()}-${input.part}`, answer: input.answer.slice(0, 500), verdict, xp },
  });
  if (xp > 0) await addActivity(course, { xp });
  return { verdict, expected, note, explanation, xp };
}

function correctionVerdict(score: number) {
  return score >= 70 ? "correct" : score >= 40 ? "almost" : "wrong";
}

/** Writing task: corrected by the AI model, with explanations and a model answer. */
export async function submitWriting(userId: string, courseId: string, practiceId: string, input: { index: number; text: string }) {
  const { course, practice, content } = await readyContent(userId, courseId, practiceId);
  if (practice.skill !== "WRITING") throw new ApiError(400, "Not a writing practice", "bad_request");
  const task = (content as WritingContent).tasks[input.index];
  if (!task) throw notFound("Task");
  const limit = rateLimit(`polylingue-correct:${userId}`, 60);
  if (!limit.allowed) throw rateLimited(limit.retryAfterSec);
  const correction = await correctText({
    target: practice.curriculum.targetLang,
    base: practice.curriculum.baseLang,
    level: practice.curriculum.level as Cefr,
    task: task.prompt,
    text: input.text,
    minWords: task.minWords,
    maxWords: task.maxWords,
  });
  const xp = Math.round(correction.score / 5);
  await prisma.langExerciseAttempt.create({
    data: { courseId, lessonId: practiceId, exerciseIndex: input.index, type: "writing", answer: input.text.slice(0, 500), verdict: correctionVerdict(correction.score), xp },
  });
  if (xp > 0) await addActivity(course, { xp });
  return { ...correction, xp, model: task.model };
}

/**
 * Speaking: the learner's recording is transcribed by Whisper. A read-aloud
 * sentence is scored word by word; an answer to an open question is
 * corrected like a writing task. The recording is kept for the learner to
 * play back: the item's latest one and its best one (recordings.ts).
 */
export async function submitSpeaking(
  userId: string,
  courseId: string,
  practiceId: string,
  input: { kind: "sentence" | "question"; index: number; audio: Buffer; filename: string },
) {
  const { course, practice, content } = await readyContent(userId, courseId, practiceId);
  if (practice.skill !== "SPEAKING") throw new ApiError(400, "Not a speaking practice", "bad_request");
  const speaking = content as SpeakingContent;
  const item = input.kind === "sentence" ? speaking.sentences[input.index] : speaking.questions[input.index];
  if (!item) throw notFound("Item");
  const limit = rateLimit(`polylingue-speak:${userId}`, 120);
  if (!limit.allowed) throw rateLimited(limit.retryAfterSec);
  const transcript = await getTranscriber().transcribe(input.audio, input.filename, { language: course.targetLang });
  // Kept to play back; a storage problem never costs the learner their answer.
  const keep = (item: string, score: number | null, heard: string) =>
    keepSpokenAnswer(userId, courseId, practiceId, item, input.audio, input.filename, score, heard).catch((err) =>
      console.error("[polylingue] keep recording", practiceId, item, err instanceof Error ? err.message : err),
    );
  const heard = transcript.segments.map((s) => s.text).join(" ").replace(/\s+/g, " ").trim();

  if (input.kind === "sentence") {
    const sentence = speaking.sentences[input.index];
    const { score, missed } = scoreSpoken(sentence.text, heard);
    const verdict = score >= 85 ? "correct" : score >= 50 ? "almost" : "wrong";
    const xp = answerXp(verdict, false);
    await prisma.langExerciseAttempt.create({ data: { courseId, lessonId: practiceId, exerciseIndex: input.index, type: "speaking-sentence", answer: heard.slice(0, 500), verdict, xp } });
    if (xp > 0) await addActivity(course, { xp });
    await keep(`sentence-${input.index}`, score, heard);
    return { kind: "sentence" as const, heard, score, missed, verdict, xp, expected: sentence.text };
  }

  const question = speaking.questions[input.index];
  if (!heard) {
    await keep(`question-${input.index}`, 0, heard);
    return { kind: "question" as const, heard, score: 0, corrected: "", corrections: [], feedback: "", xp: 0, model: question.model };
  }
  const correction = await correctText({
    target: practice.curriculum.targetLang,
    base: practice.curriculum.baseLang,
    level: practice.curriculum.level as Cefr,
    task: question.prompt,
    text: heard,
    spoken: true,
  });
  const xp = Math.round(correction.score / 5);
  await prisma.langExerciseAttempt.create({
    data: { courseId, lessonId: practiceId, exerciseIndex: input.index, type: "speaking-question", answer: heard.slice(0, 500), verdict: correctionVerdict(correction.score), xp },
  });
  if (xp > 0) await addActivity(course, { xp });
  await keep(`question-${input.index}`, correction.score, heard);
  return { kind: "question" as const, heard, ...correction, xp, model: question.model };
}

/** Practice finished: score, bonus XP and time; listening reveals its transcript. */
export async function completePractice(userId: string, courseId: string, practiceId: string, input: { score: number; seconds: number }) {
  const { course, practice, content } = await readyContent(userId, courseId, practiceId);
  const score = Math.max(0, Math.min(100, Math.round(input.score)));
  const bonus = lessonBonus(score);
  const previous = await prisma.langPracticeProgress.findUnique({ where: { courseId_practiceId: { courseId, practiceId } } });
  await prisma.langPracticeProgress.upsert({
    where: { courseId_practiceId: { courseId, practiceId } },
    create: { courseId, practiceId, bestScore: score, runs: 1, xp: bonus, completedAt: new Date() },
    update: { bestScore: Math.max(previous?.bestScore ?? 0, score), runs: { increment: 1 }, xp: { increment: bonus }, completedAt: previous?.completedAt ?? new Date() },
  });
  await addActivity(course, { xp: bonus, seconds: Math.max(0, Math.min(Math.round(input.seconds), 3600)) });
  const reveal = practice.skill === "LISTENING" ? { dictation: (content as ListeningContent).dictation, passage: (content as ListeningContent).passage } : null;
  return { score, bonusXp: bonus, reveal };
}

/** Adds a word met in practice (e.g. tapped in a reading text) to the learner's review. */
export async function addWordToReview(userId: string, courseId: string, input: { term: string; translation: string; example?: string }) {
  await ownCourse(userId, courseId);
  const r = await prisma.langCard.createMany({
    data: [{ courseId, term: input.term.trim(), translation: input.translation.trim(), example: input.example?.trim() || null }],
    skipDuplicates: true,
  });
  return { added: r.count === 1 };
}
