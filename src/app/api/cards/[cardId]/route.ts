import { z } from "zod";
import { prisma, jsonSafe } from "@/lib/db";
import { apiHandler, ok, parseJsonBody, requireSession, notFound } from "@/lib/api";
import { assertStudySetAccess } from "@/lib/access";

type Ctx = { params: { cardId: string } };

/** Card editing + suspend/delete (first-class editing with version snapshots). */
const patchSchema = z.object({
  front: z.string().min(1).max(4000).optional(),
  back: z.string().min(1).max(8000).optional(),
  context: z.string().max(4000).nullable().optional(),
  tags: z.array(z.string().max(40)).max(8).optional(),
  suspended: z.boolean().optional(),
});

export const PATCH = apiHandler<Ctx>(async (req, { params }) => {
  const session = await requireSession();
  const card = await prisma.flashcard.findUnique({ where: { id: params.cardId }, include: { deck: true } });
  if (!card) throw notFound("Card");
  await assertStudySetAccess(session.user.id, card.deck.studySetId, "write");

  const body = await parseJsonBody(req, patchSchema);
  const changing = body.front !== undefined || body.back !== undefined;
  if (changing) {
    await prisma.artifactEdit.create({
      data: {
        entityType: "flashcard",
        entityId: card.id,
        version: card.reps, // reviews double as version counter for scheduling; edits tracked separately
        snapshot: { front: card.front, back: card.back, context: card.context, tags: card.tags },
        editedById: session.user.id,
      },
    });
  }

  const updated = await prisma.flashcard.update({
    where: { id: card.id },
    data: {
      ...(body.front !== undefined ? { front: body.front } : {}),
      ...(body.back !== undefined ? { back: body.back } : {}),
      ...(body.context !== undefined ? { context: body.context } : {}),
      ...(body.tags !== undefined ? { tags: body.tags } : {}),
      ...(body.suspended !== undefined ? { suspended: body.suspended } : {}),
    },
  });
  return ok(jsonSafe({ card: updated }));
});

export const DELETE = apiHandler<Ctx>(async (_req, { params }) => {
  const session = await requireSession();
  const card = await prisma.flashcard.findUnique({ where: { id: params.cardId }, include: { deck: true } });
  if (!card) throw notFound("Card");
  await assertStudySetAccess(session.user.id, card.deck.studySetId, "write");
  await prisma.flashcard.delete({ where: { id: card.id } });
  return ok({ deleted: true });
});
