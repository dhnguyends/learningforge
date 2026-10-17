import { prisma, jsonSafe } from "@/lib/db";
import { apiHandler, ok, requireSession } from "@/lib/api";
import { assertStudySetAccess } from "@/lib/access";
import { getScheduler, DEFAULT_ALGORITHM } from "@/lib/srs/fsrs";
import { format, subDays } from "date-fns";

type Ctx = { params: { studySetId: string } };

/**
 * Analytics + transparent recommendations.
 * Every recommendation carries a human-readable reason built from the data.
 */
export const GET = apiHandler<Ctx>(async (_req, { params }) => {
  const session = await requireSession();
  const studySet = await assertStudySetAccess(session.user.id, params.studySetId);

  const [metrics, decks, recentAttempts, sessions, guides] = await Promise.all([
    prisma.progressMetric.findMany({
      where: { studySetId: studySet.id, userId: session.user.id },
      orderBy: { mastery: "asc" },
    }),
    prisma.flashcardDeck.findMany({
      where: { studySetId: studySet.id },
      include: { cards: { where: { suspended: false }, select: { id: true, state: true, stability: true, difficulty: true, reps: true, lapses: true, lastReviewedAt: true, dueAt: true, tags: true, deck: { select: { algorithm: true } } } } },
    }),
    prisma.attempt.findMany({
      where: { studySetId: studySet.id, userId: session.user.id, createdAt: { gte: subDays(new Date(), 30) } },
      orderBy: { createdAt: "desc" },
      select: { subjectType: true, score: true, createdAt: true },
    }),
    prisma.studySession.findMany({
      where: { studySetId: studySet.id, userId: session.user.id },
      orderBy: { startedAt: "desc" },
      take: 30,
    }),
    prisma.studyGuide.count({ where: { studySetId: studySet.id } }),
  ]);

  // --- Mastery by topic (0..1) with trend from attempt order ---
  const trendOf = (scores: number[] | undefined): "up" | "down" | "flat" => {
    if (!scores || scores.length < 4) return "flat";
    const mid = Math.floor(scores.length / 2);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const delta = mean(scores.slice(mid)) - mean(scores.slice(0, mid));
    if (delta > 0.1) return "up";
    if (delta < -0.1) return "down";
    return "flat";
  };

  // --- Flashcard retention (mean predicted retrievability, FSRS) ---
  const scheduler = getScheduler(DEFAULT_ALGORITHM);
  const allCards = decks.flatMap((d) => d.cards);
  const scheduledCards = allCards.filter((c) => c.lastReviewedAt);
  const retention = scheduledCards.length
    ? scheduledCards.reduce((sum, c) => sum + (scheduler.retrievability(c as never) ?? 0), 0) / scheduledCards.length
    : null;

  // --- Accuracy by learning objective & difficulty (quiz questions) ---
  const questionAttempts = await prisma.attempt.findMany({
    where: { studySetId: studySet.id, userId: session.user.id, subjectType: "QUIZ_QUESTION" },
    select: { subjectId: true, score: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const questions = await prisma.quizQuestion.findMany({
    where: { quiz: { studySetId: studySet.id } },
    select: { id: true, learningObjective: true, difficulty: true },
  });
  const questionById = new Map(questions.map((q) => [q.id, q]));
  const byObjective = new Map<string, { total: number; score: number }>();
  const byDifficulty = new Map<string, { total: number; score: number }>();
  const objectiveTimeline = new Map<string, number[]>(); // scores in attempt order, for trend
  for (const attempt of questionAttempts) {
    const q = questionById.get(attempt.subjectId);
    if (!q) continue;
    const obj = byObjective.get(q.learningObjective) ?? { total: 0, score: 0 };
    obj.total += 1;
    obj.score += attempt.score ?? 0;
    byObjective.set(q.learningObjective, obj);
    const timeline = objectiveTimeline.get(q.learningObjective);
    if (timeline) timeline.push(attempt.score ?? 0);
    else objectiveTimeline.set(q.learningObjective, [attempt.score ?? 0]);
    const diff = byDifficulty.get(q.difficulty) ?? { total: 0, score: 0 };
    diff.total += 1;
    diff.score += attempt.score ?? 0;
    byDifficulty.set(q.difficulty, diff);
  }
  // After the timeline above: the trend reads it.
  const topics = metrics.map((m) => ({
    topic: m.topic,
    mastery: Math.round(m.mastery * 100) / 100,
    attempts: m.attempts,
    trend: trendOf(objectiveTimeline.get(m.topic)),
  }));

  // --- Time studied ---
  const totalMs = sessions.reduce((sum, s) => sum + ((s.endedAt ?? new Date()).getTime() - s.startedAt.getTime()), 0);
  const byDay = new Map<string, number>();
  for (const s of sessions) {
    const day = format(s.startedAt, "yyyy-MM-dd");
    byDay.set(day, (byDay.get(day) ?? 0) + ((s.endedAt ?? new Date()).getTime() - s.startedAt.getTime()));
  }

  const dueCount = allCards.filter((c) => c.dueAt <= new Date()).length;

  // --- Transparent recommendations: each carries its data-derived reason ---
  const base = `/study-sets/${studySet.id}`;
  const recommendations: Array<{ kind: string; message: string; action?: { label: string; href: string } }> = [];
  const weakest = topics[0];
  if (weakest && weakest.attempts > 0 && weakest.mastery < 0.6) {
    const missed = recentAttempts.filter((a) => a.subjectType === "QUIZ_QUESTION").length;
    recommendations.push({
      kind: "quiz",
      message: `Your mastery of "${weakest.topic.slice(0, 60)}" is ${Math.round(weakest.mastery * 100)}% across ${weakest.attempts} attempt(s)${missed ? `, and you have ${missed} recent quiz attempt(s) in this set` : ""}.`,
      action: { label: `Quiz yourself on ${weakest.topic.slice(0, 40)}`, href: `${base}/quiz` },
    });
  }
  if (dueCount > 0) {
    const oldestDue = allCards
      .filter((c) => c.dueAt <= new Date())
      .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())[0];
    const daysOverdue = Math.floor((Date.now() - oldestDue.dueAt.getTime()) / 86_400_000);
    recommendations.push({
      kind: "review",
      message: `FSRS predicts you are forgetting ${dueCount} card${dueCount === 1 ? "" : "s"}${daysOverdue > 0 ? `; the most overdue card is ${daysOverdue} day(s) late` : ""}.`,
      action: { label: `Review ${dueCount} due card${dueCount === 1 ? "" : "s"}`, href: `${base}/flashcards` },
    });
  }
  const weakObjective = [...byObjective.entries()].sort((a, b) => a[1].score / a[1].total - b[1].score / b[1].total)[0];
  if (weakObjective && weakObjective[1].total >= 2 && weakObjective[1].score / weakObjective[1].total < 0.6) {
    recommendations.push({
      kind: "tutor",
      message: `You scored ${Math.round((weakObjective[1].score / weakObjective[1].total) * 100)}% on ${weakObjective[1].total} question(s) targeting "${weakObjective[0].slice(0, 60)}".`,
      action: { label: `Ask the tutor about ${weakObjective[0].slice(0, 40)}`, href: `${base}/tutor` },
    });
  }
  if (recommendations.length === 0) {
    recommendations.push({
      kind: "explore",
      message: guides === 0 ? "No study guide yet — start there for a structured overview." : "No weaknesses detected yet; take a quiz to calibrate recommendations.",
      action: { label: "Open study guide", href: `${base}/guide` },
    });
  }

  return ok(
    jsonSafe({
      topics,
      flashcards: {
        total: allCards.length,
        scheduled: scheduledCards.length,
        due: dueCount,
        meanRetention: retention != null ? Math.round(retention * 100) : null,
        mature: allCards.filter((c) => (c.stability ?? 0) >= 21).length,
      },
      accuracy: {
        byObjective: [...byObjective.entries()].map(([objective, v]) => ({
          objective,
          accuracy: Math.round((v.score / v.total) * 100),
          attempts: v.total,
        })),
        byDifficulty: [...byDifficulty.entries()].map(([difficulty, v]) => ({
          difficulty,
          accuracy: Math.round((v.score / v.total) * 100),
          attempts: v.total,
        })),
      },
      timeStudied: {
        totalMinutes: Math.round(totalMs / 60000),
        byDay: [...byDay.entries()].sort().slice(-14).map(([day, ms]) => ({ day, minutes: Math.round(ms / 60000) })),
      },
      recommendations,
    }),
  );
});
