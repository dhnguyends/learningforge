import { z } from "zod";
import { prisma, jsonSafe } from "@/lib/db";
import { apiHandler, ok, parseJsonBody, requireSession, notFound, badRequest } from "@/lib/api";
import { assertStudySetAccess } from "@/lib/access";
import { getScheduler } from "@/lib/srs/fsrs";
import { recordAttemptAndProgress } from "@/lib/pipelines/grading";

type Ctx = { params: { deckId: string } };

const reviewSchema = z.object({
  cardId: z.string(),
  grade: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  durationMs: z.number().int().nonnegative().optional(),
});

/**
 * Review a card: Again/Hard/Good/Easy → scheduler (FSRS by deck algorithm)
 * → persist new scheduling state + review log + attempt for analytics.
 */
export const POST = apiHandler<Ctx>(async (req, { params }) => {
  const session = await requireSession();
  const deck = await prisma.flashcardDeck.findUnique({ where: { id: params.deckId } });
  if (!deck) throw notFound("Deck");
  await assertStudySetAccess(session.user.id, deck.studySetId, "write");

  const body = await parseJsonBody(req, reviewSchema);
  const card = await prisma.flashcard.findFirst({ where: { id: body.cardId, deckId: deck.id } });
  if (!card) throw notFound("Card");

  const scheduler = getScheduler(deck.algorithm);
  const outcome = scheduler.review(
    {
      state: card.state,
      stability: card.stability,
      difficulty: card.difficulty,
      reps: card.reps,
      lapses: card.lapses,
      lastReviewedAt: card.lastReviewedAt,
      dueAt: card.dueAt,
    },
    body.grade,
  );

  const updated = await prisma.flashcard.update({
    where: { id: card.id },
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

  await prisma.flashcardReview.create({
    data: {
      cardId: card.id,
      userId: session.user.id,
      grade: body.grade,
      stateBefore: { state: card.state, stability: card.stability, difficulty: card.difficulty, reps: card.reps, lapses: card.lapses },
      stateAfter: { state: outcome.state, stability: outcome.stability, difficulty: outcome.difficulty, reps: outcome.reps, lapses: outcome.lapses },
      scheduledFor: outcome.dueAt,
    },
  });

  // Analytics: Again counts as a miss, Good/Easy as correct, Hard as partial.
  const attemptScore = body.grade === 1 ? 0 : body.grade === 2 ? 0.5 : 1;
  const topic = card.tags[0] ?? deck.name;
  await recordAttemptAndProgress({
    userId: session.user.id,
    studySetId: deck.studySetId,
    subjectType: "FLASHCARD",
    subjectId: card.id,
    topic,
    score: attemptScore,
    response: { grade: body.grade },
    durationMs: body.durationMs,
  });

  return ok(
    jsonSafe({
      card: updated,
      intervalDays: Math.round(outcome.intervalDays * 100) / 100,
      retrievabilityBefore: outcome.retrievabilityBefore,
    }),
  );
});
