import { NextRequest } from "next/server";
import { prisma, jsonSafe } from "@/lib/db";
import { apiHandler, ok, requireSession, notFound } from "@/lib/api";
import { assertStudySetAccess } from "@/lib/access";

type Ctx = { params: { deckId: string } };

/** Cards for study. ?due=true returns only cards due now (review session). */
export const GET = apiHandler<Ctx>(async (req: NextRequest, { params }) => {
  const session = await requireSession();
  const deck = await prisma.flashcardDeck.findUnique({ where: { id: params.deckId } });
  if (!deck) throw notFound("Deck");
  await assertStudySetAccess(session.user.id, deck.studySetId);

  const dueOnly = req.nextUrl.searchParams.get("due") === "true";
  const cards = await prisma.flashcard.findMany({
    where: { deckId: deck.id, ...(dueOnly ? { dueAt: { lte: new Date() }, suspended: false } : {}) },
    orderBy: dueOnly ? [{ stability: "asc" }, { dueAt: "asc" }] : { createdAt: "asc" },
    include: { anchors: { include: { source: { select: { id: true, title: true, type: true } } } } },
  });
  return ok(jsonSafe({ deck, cards }));
});
