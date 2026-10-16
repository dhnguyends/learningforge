import { prisma } from "@/lib/db";
import { prepareLesson } from "@/lib/polylingue/curriculum";
import type { LessonContent } from "@/lib/polylingue/content";
import { answerExercise, completeLesson, lessonForPlayer, ownCourse } from "@/lib/polylingue/service";

/**
 * Offline practice (installable app): the next lessons, with their answers
 * so the browser can correct them, and the audio to cache. Results played
 * offline come back once online and are applied once (the browser's sync id).
 */
export const OFFLINE_LESSONS = 3;

export function speechPath(lang: string, text: string): string {
  return `/api/polylingue/speech?lang=${encodeURIComponent(lang)}&text=${encodeURIComponent(text)}`;
}

/** Every text a lesson can play: its words, exercise audio and the words to match. */
export function lessonAudioTexts(content: LessonContent): string[] {
  const texts = new Set<string>();
  for (const w of content.words) if (w.term.trim()) texts.add(w.term.trim());
  for (const e of content.exercises) {
    if (e.audio?.trim()) texts.add(e.audio.trim());
    for (const p of e.pairs ?? []) if (p.left.trim()) texts.add(p.left.trim());
  }
  return [...texts];
}

export async function offlinePackage(userId: string, courseId: string) {
  const course = await ownCourse(userId, courseId);
  const candidates = await prisma.langLesson.findMany({
    where: { curriculumId: course.curriculumId, courseId: null, progress: { none: { courseId, completedAt: { not: null } } } },
    orderBy: { ordinal: "asc" },
    take: OFFLINE_LESSONS,
    select: { id: true, status: true, content: true },
  });
  const lessons = [];
  const audio = new Set<string>();
  for (const c of candidates) {
    if (c.status !== "READY" || !c.content) {
      void prepareLesson(c.id).catch(() => undefined);
      continue;
    }
    const content = c.content as unknown as LessonContent;
    lessons.push({ player: await lessonForPlayer(userId, courseId, c.id), exercises: content.exercises });
    for (const t of lessonAudioTexts(content)) audio.add(speechPath(course.targetLang, t));
  }
  return { courseId, targetLang: course.targetLang, savedAt: new Date().toISOString(), lessons, audio: [...audio] };
}

export interface OfflineResult {
  syncId: string;
  lessonId: string;
  answers: { index: number; answer: string; retry: boolean; hinted?: boolean }[];
  complete: { firstTryCorrect: number; total: number; seconds: number } | null;
}

/** Applies a lesson played offline: answers re-checked here (XP), then the completion. */
export async function syncOfflineLesson(userId: string, courseId: string, input: OfflineResult) {
  await ownCourse(userId, courseId);
  if (await prisma.langOfflineSync.findUnique({ where: { id: input.syncId } })) return { alreadySynced: true, xp: 0, score: null };
  try {
    await prisma.langOfflineSync.create({ data: { id: input.syncId, courseId, lessonId: input.lessonId } });
  } catch {
    return { alreadySynced: true, xp: 0, score: null };
  }
  try {
    let xp = 0;
    for (const a of input.answers) xp += (await answerExercise(userId, courseId, input.lessonId, a)).xp;
    const done = input.complete ? await completeLesson(userId, courseId, input.lessonId, input.complete) : null;
    return { alreadySynced: false, xp: xp + (done?.bonusXp ?? 0), score: done?.score ?? null };
  } catch (err) {
    // Not applied: let the browser try again later.
    await prisma.langOfflineSync.delete({ where: { id: input.syncId } }).catch(() => undefined);
    throw err;
  }
}
