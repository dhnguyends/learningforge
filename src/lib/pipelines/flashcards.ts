import { prisma } from "@/lib/db";
import { getGenerator, isMockAI } from "@/lib/ai";
import { searchChunks, retrieveForWholeSet, formatRetrievedContext, emptyRetrievalError, type RetrievedChunk } from "@/lib/retrieval";
import { createAnchorsForChunks } from "@/lib/pipelines/anchors";
import { flashcardsSchema, type FlashcardDraft } from "@/lib/pipelines/schemas";
import { dedupeFlashcards, resolveChunkRef, resolveChunkRefs } from "@/lib/pipelines/validation";
import { FLASHCARDS_SYSTEM, FLASHCARDS_USER, PROMPT_VERSION } from "@/lib/prompts";
import type { JobContext } from "@/lib/queue/types";
import { audit } from "@/lib/audit";

interface FlashcardsJobPayload {
  studySetId: string;
  deckId: string;
  focus?: string;
  count?: number;
  cardTypes?: string[];
  generationJobId?: string;
}

export async function generateFlashcardsJob(ctx: JobContext<FlashcardsJobPayload>): Promise<void> {
  const { deckId } = ctx.payload;
  const deck = await prisma.flashcardDeck.findUnique({
    where: { id: deckId },
    include: { studySet: { select: { id: true, title: true } } },
  });
  if (!deck) throw new Error(`Deck ${deckId} not found`);
  await prisma.flashcardDeck.update({ where: { id: deckId }, data: {} }).catch(() => undefined);

  await ctx.updateStage("retrieving-sources", 15);
  // An explicit focus is a real query; without one the deck covers the set.
  const chunks = ctx.payload.focus
    ? await searchChunks(deck.studySet.id, ctx.payload.focus, { k: 20 })
    : await retrieveForWholeSet(deck.studySet.id, deck.studySet.title, { k: 20 });
  if (chunks.length === 0) throw await emptyRetrievalError(deck.studySet.id);

  await ctx.updateStage("generating-cards", 45);
  const count = ctx.payload.count ?? 14;
  const result = await getGenerator().generate({
    system: FLASHCARDS_SYSTEM,
    user: FLASHCARDS_USER({
      studySetTitle: deck.studySet.title,
      count,
      focus: ctx.payload.focus,
      cardTypes: ctx.payload.cardTypes,
      chunkContext: formatRetrievedContext(chunks),
    }),
    schema: flashcardsSchema,
    mock: () => mockFlashcards(chunks, count),
  });

  await ctx.updateStage("validating", 80);
  const validChunkIds = new Set(chunks.map((c) => c.id));
  const drafts = result.data.cards
    .map((c) => ({ ...c, chunkId: resolveChunkRef(c.chunkId, chunks.map((x) => x.id)) ?? "" }))
    .filter((c) => validChunkIds.has(c.chunkId))
    .map((c) => ({
      ...c,
      supportingChunkIds: resolveChunkRefs(c.supportingChunkIds, chunks.map((x) => x.id)),
    }));
  const { kept, duplicates } = dedupeFlashcards(drafts);
  if (kept.length === 0) throw new Error("Generation produced no valid, source-cited cards.");

  // Regeneration replaces the deck's generated cards; user-edited cards persist.
  const previous = await prisma.flashcard.findMany({
    where: { deckId },
    select: { id: true, reps: true },
  });
  const generatedIds = previous.filter((c) => c.reps === 0).map((c) => c.id);
  if (generatedIds.length) await prisma.flashcard.deleteMany({ where: { id: { in: generatedIds } } });

  const chunkById = new Map(chunks.map((c) => [c.id, c] as const));
  const warnings = duplicates > 0 ? [`Removed ${duplicates} near-duplicate card(s).`] : [];
  for (const draft of kept) {
    const chunk = chunkById.get(draft.chunkId)!;
    const support = draft.supportingChunkIds.map((id) => chunkById.get(id)!).filter(Boolean);
    const anchorIds = await createAnchorsForChunks([chunk, ...support]);
    await prisma.flashcard.create({
      data: {
        deckId,
        type: draft.type.toUpperCase() as never,
        front: draft.front,
        back: draft.back,
        tags: draft.tags,
        warnings,
        anchors: { connect: anchorIds.map((id) => ({ id })) },
      },
    });
  }

  await audit({
    action: "ai.generation",
    entityType: "flashcard_deck",
    entityId: deckId,
    metadata: { type: "flashcards", created: kept.length, duplicates, provider: result.provider, promptVersion: PROMPT_VERSION },
  });
  await ctx.updateStage("complete", 100);
}

function mockFlashcards(chunks: RetrievedChunk[], count: number) {
  const cards: FlashcardDraft[] = [];
  for (const chunk of chunks) {
    if (cards.length >= count) break;
    for (const sentence of chunk.content.split(/(?<=[.!?])\s+/)) {
      if (cards.length >= count) break;
      const words = sentence.split(/\s+/);
      const keyIdx = words.findIndex((w) => w.length > 7 && /^[A-Za-z]/.test(w));
      if (keyIdx === -1 || words.length < 8) continue;
      const term = words[keyIdx].replace(/[^A-Za-z0-9-]/g, "");
      const front = sentence.replace(words[keyIdx], `{{${term}}}`);
      cards.push({
        type: "cloze",
        front,
        back: `**${term}** — from "${chunk.sourceTitle}" (${chunk.startMs != null ? `${Math.floor(chunk.startMs / 60000)}m` : `p. ${chunk.page}`}). Configure a real AI provider for smarter cards.`,
        tags: ["auto", "mock"],
        chunkId: chunk.id,
        supportingChunkIds: [],
      });
      break; // one card per chunk keeps mock decks varied
    }
  }
  if (cards.length === 0) {
    const chunk = chunks[0];
    cards.push({
      type: "basic",
      front: `What does the source "${chunk.sourceTitle}" discuss in its opening section?`,
      back: chunk.content.slice(0, 300),
      tags: ["auto", "mock"],
      chunkId: chunk.id,
      supportingChunkIds: [],
    });
  }
  return { cards };
}
