import { describe, it, expect, beforeAll, afterAll } from "vitest";
import "./helpers";
import { prisma, createTestUser, disposeTestUser, signInAs, jsonRequest, type TestUser } from "./helpers";
import { POST as reviewCard } from "@/app/api/decks/[deckId]/review/route";

/**
 * The review endpoint is the FSRS write path: it must apply the scheduler's
 * outcome to the card, append an immutable review log, and record an attempt
 * for analytics — atomically per request.
 */

let me: TestUser;
let deckId: string;
let newCardId: string;
let reviewCardId: string;
const studySetIds: string[] = [];

beforeAll(async () => {
  me = await createTestUser("Reviewer");

  const studySet = await prisma.studySet.create({
    data: { workspaceId: me.workspaceId, createdById: me.id, title: "Scheduling fixtures" },
  });
  studySetIds.push(studySet.id);
  const deck = await prisma.flashcardDeck.create({
    data: { studySetId: studySet.id, name: "Scheduling deck", algorithm: "fsrs-4.5" },
  });
  deckId = deck.id;

  const fresh = await prisma.flashcard.create({
    data: {
      deckId: deck.id,
      type: "BASIC",
      front: "Why is reverse mode cheap?",
      back: "One sweep per scalar output.",
      tags: ["ad"],
      state: "NEW",
      reps: 0,
      lapses: 0,
      dueAt: new Date(Date.now() - 3_600_000),
      algorithm: "fsrs-4.5",
    },
  });
  newCardId = fresh.id;

  const seasoned = await prisma.flashcard.create({
    data: {
      deckId: deck.id,
      type: "BASIC",
      front: "Momentum update?",
      back: "v ← βv + g.",
      tags: ["optimizers"],
      state: "REVIEW",
      stability: 12.5,
      difficulty: 5.2,
      reps: 5,
      lapses: 0,
      lastReviewedAt: new Date(Date.now() - 4 * 86_400_000),
      dueAt: new Date(),
      algorithm: "fsrs-4.5",
    },
  });
  reviewCardId = seasoned.id;
});

afterAll(async () => {
  await disposeTestUser(me.email);
  await prisma.$disconnect();
});

const call = (cardId: string, grade: 1 | 2 | 3 | 4) =>
  reviewCard(jsonRequest(`http://localhost/api/decks/${deckId}/review`, "POST", { cardId, grade }), {
    params: { deckId },
  });

describe("POST /api/decks/:deckId/review", () => {
  it("rejects unauthenticated requests", async () => {
    signInAs(null);
    const res = await call(newCardId, 3);
    expect(res.status).toBe(401);
  });

  it("rejects users outside the deck's workspace", async () => {
    const outsider = await createTestUser("Outsider");
    signInAs(outsider.id);
    const res = await call(newCardId, 3);
    expect(res.status).toBe(403);
    await disposeTestUser(outsider.email);
  });

  it("rejects invalid grades with 400", async () => {
    signInAs(me.id);
    const res = await reviewCard(
      jsonRequest(`http://localhost/api/decks/${deckId}/review`, "POST", { cardId: newCardId, grade: 5 }),
      { params: { deckId } },
    );
    expect(res.status).toBe(400);
  });

  it("graduates a NEW card on Good and persists scheduler state", async () => {
    signInAs(me.id);
    const res = await call(newCardId, 3);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { card: { reps: number; state: string }; intervalDays: number };
    expect(body.card.state).toBe("REVIEW");
    expect(body.card.reps).toBe(1);
    expect(body.intervalDays).toBeGreaterThanOrEqual(1);

    const persisted = await prisma.flashcard.findUnique({ where: { id: newCardId } });
    expect(persisted?.state).toBe("REVIEW");
    expect(persisted?.lastReviewedAt).toBeTruthy();
    expect(persisted?.dueAt.getTime()).toBeGreaterThan(Date.now());
    expect(persisted?.stability).toBeGreaterThan(0);
  });

  it("reschedules a REVIEW card after a lapse into relearning", async () => {
    signInAs(me.id);
    const before = await prisma.flashcard.findUnique({ where: { id: reviewCardId } });
    const res = await call(reviewCardId, 1);
    expect(res.status).toBe(200);

    const after = await prisma.flashcard.findUnique({ where: { id: reviewCardId } });
    expect(after?.state).toBe("RELEARNING");
    expect(after?.lapses).toBe(before!.lapses + 1);
    expect(after?.dueAt.getTime()).toBeLessThan(Date.now() + 60 * 60_000);
  });

  it("appends an immutable review log per review", async () => {
    const logs = await prisma.flashcardReview.findMany({ where: { cardId: newCardId } });
    expect(logs).toHaveLength(1);
    const log = logs[0];
    expect(log.grade).toBe(3);
    expect(log.userId).toBe(me.id);
    expect(log.scheduledFor.getTime()).toBeGreaterThan(Date.now());
    expect(log.stateBefore).toMatchObject({ state: "NEW", reps: 0 });
    expect(log.stateAfter).toMatchObject({ state: "REVIEW", reps: 1 });
  });

  it("records attempts keyed to the card's first tag for analytics", async () => {
    const attempts = await prisma.attempt.findMany({ where: { subjectId: newCardId, subjectType: "FLASHCARD" } });
    expect(attempts).toHaveLength(1);
    expect(attempts[0].score).toBe(1); // Good → correct
    expect(attempts[0].response).toMatchObject({ grade: 3 });
  });

  it("updates the progress metric for the topic", async () => {
    const metric = await prisma.progressMetric.findFirst({
      where: { userId: me.id, studySetId: studySetIds[0], topic: "ad" },
    });
    expect(metric).not.toBeNull();
    expect(metric?.attempts).toBeGreaterThanOrEqual(1);
  });

  it("404s for a card that does not belong to the deck", async () => {
    signInAs(me.id);
    const res = await call("does-not-exist", 3);
    expect(res.status).toBe(404);
  });
});
