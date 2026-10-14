import { z } from "zod";
import { prisma, jsonSafe } from "@/lib/db";
import { apiHandler, notFound, ok, parseJsonBody, requireSession } from "@/lib/api";
import { assertStudySetAccess } from "@/lib/access";
import { startGeneration } from "@/lib/api/generations";

type Ctx = { params: { studySetId: string } };

export const GET = apiHandler<Ctx>(async (_req, { params }) => {
  const session = await requireSession();
  const studySet = await assertStudySetAccess(session.user.id, params.studySetId);
  const decks = await prisma.flashcardDeck.findMany({
    where: { studySetId: studySet.id },
    include: { cards: { select: { id: true, dueAt: true, suspended: true, state: true, type: true } } },
    orderBy: { createdAt: "asc" },
  });
  return ok(
    jsonSafe({
      decks: decks.map((d) => ({
        id: d.id,
        name: d.name,
        algorithm: d.algorithm,
        total: d.cards.length,
        due: d.cards.filter((c) => !c.suspended && c.dueAt <= new Date()).length,
        suspended: d.cards.filter((c) => c.suspended).length,
        byType: d.cards.reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.type]: (acc[c.type] ?? 0) + 1 }), {}),
      })),
    }),
  );
});

const generateSchema = z.object({
  deckId: z.string().optional(), // regenerate into an existing deck
  name: z.string().max(120).optional(),
  focus: z.string().max(300).optional(),
  count: z.number().int().min(4).max(60).default(14),
  cardTypes: z.array(z.enum(["basic", "cloze", "equation", "image_label", "code_completion", "conceptual"])).optional(),
});

export const POST = apiHandler<Ctx>(async (req, { params }) => {
  const session = await requireSession();
  const studySet = await assertStudySetAccess(session.user.id, params.studySetId, "write");
  const body = await parseJsonBody(req, generateSchema);

  let deck;
  if (body.deckId) {
    const existing = await prisma.flashcardDeck.findFirst({ where: { id: body.deckId, studySetId: studySet.id } });
    if (!existing) throw notFound("Deck");
    deck = existing;
  } else {
    deck = await prisma.flashcardDeck.create({
      data: { studySetId: studySet.id, name: body.name ?? "Generated deck", generatedFrom: { focus: body.focus ?? null } },
    });
  }

  const { jobId } = await startGeneration({
    userId: session.user.id,
    studySetId: studySet.id,
    type: "GENERATE_FLASHCARDS",
    jobName: "generate.flashcards",
    payload: { deckId: deck.id, focus: body.focus, count: body.count, cardTypes: body.cardTypes },
  });
  return ok({ deckId: deck.id, jobId }, { status: 202 });
});
