import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma, jsonSafe } from "@/lib/db";
import { apiHandler, ok, parseJsonBody, requireSession } from "@/lib/api";
import { assertStudySetAccess } from "@/lib/access";
import { deleteStudySetCompletely } from "@/lib/deletion";
import { audit } from "@/lib/audit";
import { ensureRecovered } from "@/lib/queue/recovery";

type Ctx = { params: { studySetId: string } };

export const GET = apiHandler<Ctx>(async (_req, { params }) => {
  // The detail view polls this endpoint while jobs are active — the natural
  // place to resume any jobs orphaned by a server restart (no-op afterwards).
  void ensureRecovered();
  const session = await requireSession();
  const studySet = await assertStudySetAccess(session.user.id, params.studySetId);

  const [sources, guides, decks, quizzes, exerciseSets, jobs, conversations] = await Promise.all([
    prisma.source.findMany({
      where: { studySetId: studySet.id },
      orderBy: { createdAt: "asc" },
      include: { assets: { select: { id: true, kind: true, filename: true, mimeType: true, durationSec: true } } },
    }),
    prisma.studyGuide.findMany({ where: { studySetId: studySet.id }, include: { sections: { select: { id: true, title: true, kind: true } } } }),
    prisma.flashcardDeck.findMany({
      where: { studySetId: studySet.id },
      include: { cards: { select: { id: true, dueAt: true, suspended: true, state: true } } },
    }),
    prisma.quiz.findMany({ where: { studySetId: studySet.id }, include: { _count: { select: { questions: true } } } }),
    prisma.exerciseSet.findMany({ where: { studySetId: studySet.id }, include: { _count: { select: { exercises: true } } } }),
    prisma.generationJob.findMany({
      where: { studySetId: studySet.id },
      orderBy: { createdAt: "desc" },
      take: 12,
    }),
    prisma.tutorConversation.findMany({ where: { studySetId: studySet.id }, orderBy: { updatedAt: "desc" }, take: 5, select: { id: true, title: true, updatedAt: true } }),
  ]);

  return ok(
    jsonSafe({
      // The detail page reads set.counts.* — mirror the list endpoint's shape
      // (a raw Prisma row has no counts and crashes the client).
      studySet: {
        ...studySet,
        counts: {
          sources: sources.length,
          sourcesReady: sources.filter((s) => s.status === "READY").length,
          sourcesProcessing: sources.filter((s) => s.status === "PROCESSING" || s.status === "PENDING_UPLOAD").length,
          decks: decks.length,
          quizzes: quizzes.length,
          exerciseSets: exerciseSets.length,
        },
      },
      sources: sources.map((s) => ({
        ...s,
        error: s.error,
        durationSec: s.durationSec,
        hasAudioAsset: s.assets.some((a) => a.kind === "AUDIO"),
      })),
      guides,
      decks: decks.map((d) => ({
        id: d.id,
        name: d.name,
        algorithm: d.algorithm,
        total: d.cards.length,
        due: d.cards.filter((c) => !c.suspended && c.dueAt <= new Date()).length,
        suspended: d.cards.filter((c) => c.suspended).length,
      })),
      quizzes,
      exerciseSets,
      jobs,
      conversations,
    }),
  );
});

const patchSchema = z.object({
  title: z.string().min(3).max(160).optional(),
  course: z.string().max(120).nullable().optional(),
  subject: z.string().max(120).nullable().optional(),
  learnerLevel: z.enum(["INTRODUCTORY", "ADVANCED_UNDERGRAD", "GRADUATE"]).optional(),
  examDate: z.string().datetime().nullable().optional(),
  outputTypes: z.array(z.enum(["GUIDE", "FLASHCARDS", "QUIZ", "EXERCISES", "AUDIO_RECAP", "TUTOR"])).optional(),
  settings: z.record(z.unknown()).optional(),
  archived: z.boolean().optional(),
});

export const PATCH = apiHandler<Ctx>(async (req, { params }) => {
  const session = await requireSession();
  const studySet = await assertStudySetAccess(session.user.id, params.studySetId, "write");
  const body = await parseJsonBody(req, patchSchema);

  const updated = await prisma.studySet.update({
    where: { id: studySet.id },
    data: {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.course !== undefined ? { course: body.course } : {}),
      ...(body.subject !== undefined ? { subject: body.subject } : {}),
      ...(body.learnerLevel !== undefined ? { learnerLevel: body.learnerLevel } : {}),
      ...(body.examDate !== undefined ? { examDate: body.examDate ? new Date(body.examDate) : null } : {}),
      ...(body.outputTypes !== undefined ? { outputTypes: body.outputTypes } : {}),
      // zod's z.record() widens values to `unknown`; Prisma needs its JSON input type.
      ...(body.settings !== undefined
        ? { settings: { ...(studySet.settings as object), ...body.settings } as Prisma.InputJsonValue }
        : {}),
      ...(body.archived !== undefined ? { archivedAt: body.archived ? new Date() : null } : {}),
    },
  });
  return ok(jsonSafe({ studySet: updated }));
});

export const DELETE = apiHandler<Ctx>(async (_req, { params }) => {
  const session = await requireSession();
  const studySet = await assertStudySetAccess(session.user.id, params.studySetId, "write");

  // Permanent deletion of the set, its sources and their stored files.
  await deleteStudySetCompletely(studySet.id);
  await audit({ userId: session.user.id, action: "study_set.delete", entityType: "study_set", entityId: studySet.id });
  return ok({ deleted: true });
});
