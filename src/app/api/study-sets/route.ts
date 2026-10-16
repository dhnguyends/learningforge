import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiHandler, ok, parseJsonBody, requireSession, badRequest, publicOrigin } from "@/lib/api";
import { ensureUserWorkspace } from "@/lib/auth";
import { assertStudySetAccess, listUserWorkspaceIds } from "@/lib/access";
import { getStorage, sourceAssetKey } from "@/lib/storage";
import { validateUploadIntent, isRecordingType, estimateProcessingSec } from "@/lib/uploads";
import { parseYouTubeId, canonicalYouTubeUrl, fetchYouTubeMeta } from "@/lib/media/ffmpeg";
import { enqueue } from "@/lib/queue";
import { ensureRecovered } from "@/lib/queue/recovery";
import { jsonSafe } from "@/lib/db";
import { audit } from "@/lib/audit";
import { TOPIC_SELECT, toClassification } from "@/lib/taxonomy/store";
import { RELATED_SELECT, toRelated } from "@/lib/taxonomy/related";

const sourceInputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("file"),
    filename: z.string().min(1).max(255),
    mimeType: z.string().min(3),
    sizeBytes: z.number().int().positive(),
    title: z.string().max(200).optional(),
  }),
  z.object({
    kind: z.literal("youtube"),
    url: z.string().url(),
    consent: z.literal(true, { errorMap: () => ({ message: "You must confirm you have permission to process this recording." }) }),
    title: z.string().max(200).optional(),
  }),
]);

const createSchema = z.object({
  title: z.string().min(3).max(160),
  course: z.string().max(120).optional(),
  subject: z.string().max(120).optional(),
  learnerLevel: z.enum(["INTRODUCTORY", "ADVANCED_UNDERGRAD", "GRADUATE"]).optional(),
  examDate: z.string().datetime().optional(),
  language: z.string().length(2).optional(),
  outputTypes: z.array(z.enum(["GUIDE", "FLASHCARDS", "QUIZ", "EXERCISES", "AUDIO_RECAP", "TUTOR"])).default([]),
  settings: z
    .object({
      transcriptLanguage: z.string().length(2).optional(),
      diarization: z.boolean().optional(),
      preserveEquations: z.boolean().optional(),
      detailLevel: z.enum(["concise", "detailed", "comprehensive"]).optional(),
      citationStrictness: z.enum(["relaxed", "standard", "strict"]).optional(),
      sourceOnlyMode: z.boolean().optional(),
      includeExternal: z.boolean().optional(), // default false — spec requirement
    })
    .default({}),
  rightsConfirmed: z.boolean().default(false),
  // Sources are optional at creation (dashboard quick-create adds them later).
  sources: z.array(sourceInputSchema).max(10).default([]),
});

export const GET = apiHandler(async (req) => {
  // Dashboard entry point: resume jobs orphaned by a server restart before the
  // user stares at a spinner that will never move (no-op after the first call).
  void ensureRecovered();
  const session = await requireSession();
  const workspaceIds = await listUserWorkspaceIds(session.user.id);
  const studySets = await prisma.studySet.findMany({
    where: { workspaceId: { in: workspaceIds }, archivedAt: null },
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { sources: true, decks: true, quizzes: true, exerciseSets: true } },
      sources: { select: { status: true } },
      topic: TOPIC_SELECT,
      relatedTopics: RELATED_SELECT,
    },
  });

  const ids = studySets.map((s) => s.id);
  const jobs = ids.length
    ? await prisma.generationJob.findMany({
        where: { studySetId: { in: ids }, status: { in: ["QUEUED", "RUNNING"] } },
        select: { studySetId: true, type: true, status: true, stage: true, progress: true },
      })
    : [];
  const deckToSet = new Map(
    (await prisma.flashcardDeck.findMany({ where: { studySetId: { in: ids } }, select: { id: true, studySetId: true } })).map((d) => [d.id, d.studySetId]),
  );
  const dueBySet = new Map<string, number>();
  const dueRows = await prisma.flashcard.findMany({
    where: { deck: { studySetId: { in: ids } }, dueAt: { lte: new Date() }, suspended: false },
    select: { id: true, deckId: true },
  });
  for (const row of dueRows) {
    const setId = deckToSet.get(row.deckId);
    if (setId) dueBySet.set(setId, (dueBySet.get(setId) ?? 0) + 1);
  }

  return ok(
    jsonSafe(
      studySets.map((s) => ({
        id: s.id,
        title: s.title,
        course: s.course,
        subject: s.subject,
        classification: toClassification(s.topic),
        related: toRelated(s.relatedTopics),
        learnerLevel: s.learnerLevel,
        examDate: s.examDate,
        outputTypes: s.outputTypes,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        counts: {
          sources: s._count.sources,
          decks: s._count.decks,
          quizzes: s._count.quizzes,
          exerciseSets: s._count.exerciseSets,
          sourcesReady: s.sources.filter((x) => x.status === "READY").length,
          sourcesProcessing: s.sources.filter((x) => x.status === "PROCESSING" || x.status === "PENDING_UPLOAD").length,
        },
        dueCards: dueBySet.get(s.id) ?? 0,
        activeJobs: jobs.filter((j) => j.studySetId === s.id),
      })),
    ),
  );
});

export const POST = apiHandler(async (req) => {
  const session = await requireSession();
  const body = await parseJsonBody(req, createSchema);

  const hasRecording = body.sources.some((s) => (s.kind === "file" && isRecordingFile(s.mimeType)) || s.kind === "youtube");
  if (hasRecording && !body.rightsConfirmed) {
    throw badRequest("You must confirm you have the rights to upload and process these recordings.");
  }

  const workspaceId = await ensureUserWorkspace(session.user.id, session.user.name);

  const studySet = await prisma.studySet.create({
    data: {
      workspaceId,
      createdById: session.user.id,
      title: body.title,
      course: body.course,
      subject: body.subject,
      learnerLevel: body.learnerLevel ?? "ADVANCED_UNDERGRAD",
      ...(body.examDate ? { examDate: new Date(body.examDate) } : {}),
      language: body.language ?? "en",
      outputTypes: body.outputTypes,
      settings: { includeExternal: false, ...body.settings } as object,
    },
  });

  const storage = getStorage();
  const createdSources = [];

  for (const input of body.sources) {
    if (input.kind === "file") {
      const { sourceType } = validateUploadIntent(input.mimeType, input.sizeBytes);
      const source = await prisma.source.create({
        data: {
          studySetId: studySet.id,
          type: sourceType,
          title: input.title ?? input.filename,
          status: "PENDING_UPLOAD",
          language: body.settings.transcriptLanguage ?? body.language,
          metadata: { filename: input.filename, sizeBytes: input.sizeBytes, mimeType: input.mimeType, estimatedProcessingSec: estimateProcessingSec(sourceType, input.sizeBytes) },
          ...(isRecordingType(sourceType) ? { consentConfirmedAt: new Date() } : {}),
        },
      });
      // The filename is display metadata only — never part of the storage key.
      const assetKey = sourceAssetKey(workspaceId, studySet.id, source.id, input.mimeType);
      // See sources/route.ts — tickets must point back at the requesting origin.
      const ticket = await storage.createUpload(assetKey, {
        contentType: input.mimeType,
        baseUrl: publicOrigin(req),
        userId: session.user.id,
        maxBytes: input.sizeBytes,
      });
      await prisma.sourceAsset.create({
        data: {
          sourceId: source.id,
          kind: "ORIGINAL",
          storageKey: assetKey,
          filename: input.filename,
          mimeType: input.mimeType,
          sizeBytes: BigInt(input.sizeBytes),
        },
      });
      createdSources.push({ id: source.id, kind: "file", upload: ticket, estimatedProcessingSec: estimateProcessingSec(sourceType, input.sizeBytes) });
    } else {
      // YouTube import — validated + consented now, ingested as a job.
      const videoId = parseYouTubeId(input.url);
      if (!videoId) throw badRequest("Not a valid YouTube URL");
      const meta = await fetchYouTubeMeta(input.url).catch(() => null);
      const source = await prisma.source.create({
        data: {
          studySetId: studySet.id,
          type: "YOUTUBE",
          title: input.title ?? meta?.title ?? `YouTube video ${videoId}`,
          status: "PROCESSING",
          externalUrl: canonicalYouTubeUrl(videoId), // never store the raw user URL
          consentConfirmedAt: new Date(),
          metadata: { videoId, author: meta?.author, thumbnail: meta?.thumbnail, estimatedProcessingSec: estimateProcessingSec("YOUTUBE") },
        },
      });
      const job = await prisma.generationJob.create({
        data: { studySetId: studySet.id, sourceId: source.id, type: "INGEST_SOURCE", payload: { sourceId: source.id } },
      });
      await enqueue("ingest.source", { sourceId: source.id, generationJobId: job.id });
      createdSources.push({ id: source.id, kind: "youtube", jobId: job.id, estimatedProcessingSec: estimateProcessingSec("YOUTUBE") });
    }
  }

  await audit({ userId: session.user.id, action: "study_set.create", entityType: "study_set", entityId: studySet.id, metadata: { sources: body.sources.length } });
  return ok(jsonSafe({ studySet, sources: createdSources }), { status: 201 });
});

function isRecordingFile(mime: string): boolean {
  const type = mime.split("/")[0];
  return type === "video" || type === "audio";
}
