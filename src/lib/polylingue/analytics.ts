import { prisma } from "@/lib/db";
import { dayKey } from "@/lib/polylingue/progress";
import { addDays, daysBetween } from "@/lib/polylingue/habits";
import type { LessonContent } from "@/lib/polylingue/content";

/**
 * PolyLingue analytics for admins: learners and retention (came back on day
 * 1, 7 and 30 after starting), lesson completion and time, scores, the
 * hardest exercises across all learners, and each shared course.
 */

export const RETENTION_DAYS = [1, 7, 30] as const;

/**
 * Day-N retention: among learners who started at least N days ago, the share
 * who practised on day N after their first day.
 */
export function retention(courses: { start: string; today: string; days: Set<string> }[], n: number): { eligible: number; retained: number; rate: number | null } {
  const eligible = courses.filter((c) => daysBetween(c.start, c.today) >= n);
  const retained = eligible.filter((c) => c.days.has(addDays(c.start, n))).length;
  return { eligible: eligible.length, retained, rate: eligible.length ? Math.round((retained / eligible.length) * 100) : null };
}

export async function polylingueAnalytics(now = new Date()) {
  const [courses, activity, progress, attempted, attempts, curricula, openReports] = await Promise.all([
    prisma.languageCourse.findMany({ select: { id: true, userId: true, createdAt: true, timeZone: true, curriculumId: true, user: { select: { nature: true } } } }),
    prisma.langDailyActivity.findMany({ where: { xp: { gt: 0 } }, select: { courseId: true, day: true } }),
    prisma.langLessonProgress.findMany({ select: { courseId: true, lessonId: true, completedAt: true, bestScore: true, runs: true, seconds: true } }),
    prisma.langExerciseAttempt.groupBy({ by: ["courseId", "lessonId"] }),
    prisma.langExerciseAttempt.groupBy({ by: ["lessonId", "exerciseIndex", "verdict"], _count: true }),
    prisma.langCurriculum.findMany({ select: { id: true, targetLang: true, baseLang: true, level: true } }),
    prisma.langReport.count({ where: { resolvedAt: null } }),
  ]);

  // Learners (accounts) and their activity.
  const daysByCourse = new Map<string, Set<string>>();
  for (const a of activity) {
    const set = daysByCourse.get(a.courseId) ?? new Set<string>();
    set.add(a.day);
    daysByCourse.set(a.courseId, set);
  }
  const perCourse = courses.map((c) => ({
    ...c,
    start: dayKey(c.createdAt, c.timeZone),
    today: dayKey(now, c.timeZone),
    days: daysByCourse.get(c.id) ?? new Set<string>(),
  }));
  const learners = new Set(courses.map((c) => c.userId)).size;
  const activeSince = (n: number) => new Set(perCourse.filter((c) => [...c.days].some((d) => daysBetween(d, c.today) < n)).map((c) => c.userId)).size;
  const humans = new Set(courses.filter((c) => c.user.nature === "HUMAN").map((c) => c.userId)).size;

  // Daily active learners, last 30 days (UTC days).
  const today = now.toISOString().slice(0, 10);
  const userOf = new Map(courses.map((c) => [c.id, c.userId]));
  const dailyActive = Array.from({ length: 30 }, (_, i) => addDays(today, i - 29)).map((day) => ({
    day,
    learners: new Set(activity.filter((a) => a.day === day).map((a) => userOf.get(a.courseId))).size,
  }));

  // Lessons: started (any answer) vs completed, scores and time.
  const completed = progress.filter((p) => p.completedAt);
  const startedPairs = new Set([...attempted.map((a) => `${a.courseId}:${a.lessonId}`), ...progress.map((p) => `${p.courseId}:${p.lessonId}`)]);
  const timed = completed.filter((p) => p.seconds > 0 && p.runs > 0);
  const lessons = {
    started: startedPairs.size,
    completed: completed.length,
    completionRate: startedPairs.size ? Math.round((completed.length / startedPairs.size) * 100) : null,
    averageScore: completed.length ? Math.round(completed.reduce((n, p) => n + p.bestScore, 0) / completed.length) : null,
    averageMinutes: timed.length ? Math.round((timed.reduce((n, p) => n + p.seconds / p.runs, 0) / timed.length / 60) * 10) / 10 : null,
    timedLessons: timed.length,
  };

  // Hardest exercises (at least 5 answers).
  const byExercise = new Map<string, { lessonId: string; index: number; wrong: number; total: number }>();
  for (const a of attempts) {
    const key = `${a.lessonId}:${a.exerciseIndex}`;
    const e = byExercise.get(key) ?? { lessonId: a.lessonId, index: a.exerciseIndex, wrong: 0, total: 0 };
    e.total += a._count;
    if (a.verdict === "wrong") e.wrong += a._count;
    byExercise.set(key, e);
  }
  const hard = [...byExercise.values()]
    .filter((e) => e.total >= 5 && e.wrong > 0)
    .sort((a, b) => b.wrong / b.total - a.wrong / a.total || b.total - a.total)
    .slice(0, 15);
  const hardLessons = new Map(
    (
      await prisma.langLesson.findMany({
        where: { id: { in: hard.map((h) => h.lessonId) } },
        select: { id: true, title: true, content: true, curriculum: { select: { targetLang: true, level: true } } },
      })
    ).map((l) => [l.id, l]),
  );
  const hardest = hard.map((h) => {
    const l = hardLessons.get(h.lessonId);
    const ex = (l?.content as LessonContent | null)?.exercises?.[h.index];
    return {
      lessonId: h.lessonId,
      index: h.index,
      lesson: l?.title ?? "",
      targetLang: l?.curriculum.targetLang ?? "",
      level: l?.curriculum.level ?? "",
      type: ex?.type ?? "",
      prompt: ex?.prompt ?? "",
      answer: ex?.answer ?? "",
      wrongRate: Math.round((h.wrong / h.total) * 100),
      answers: h.total,
    };
  });

  // Per shared course.
  const lessonCurriculum = new Map(
    (await prisma.langLesson.findMany({ where: { id: { in: [...new Set(completed.map((p) => p.lessonId))] } }, select: { id: true, curriculumId: true } })).map((l) => [
      l.id,
      l.curriculumId,
    ]),
  );
  const perCurriculum = curricula
    .map((c) => {
      const done = completed.filter((p) => lessonCurriculum.get(p.lessonId) === c.id);
      return {
        ...c,
        learners: courses.filter((x) => x.curriculumId === c.id).length,
        lessonsCompleted: done.length,
        averageScore: done.length ? Math.round(done.reduce((n, p) => n + p.bestScore, 0) / done.length) : null,
      };
    })
    .filter((c) => c.learners > 0 || c.lessonsCompleted > 0)
    .sort((a, b) => b.learners - a.learners);

  return {
    learners: { total: learners, humans, courses: courses.length, active7: activeSince(7), active30: activeSince(30) },
    retention: Object.fromEntries(RETENTION_DAYS.map((n) => [`day${n}`, retention(perCourse, n)])) as Record<`day${(typeof RETENTION_DAYS)[number]}`, ReturnType<typeof retention>>,
    dailyActive,
    lessons,
    hardest,
    curricula: perCurriculum,
    openReports,
  };
}
