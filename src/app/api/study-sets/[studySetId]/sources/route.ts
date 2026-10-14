import { z } from "zod";
import { prisma, jsonSafe } from "@/lib/db";
import { apiHandler, ok, parseJsonBody, requireSession, badRequest } from "@/lib/api";
import { assertStudySetAccess } from "@/lib/access";
import { getStorage, sourceAssetKey } from "@/lib/storage";
import { validateUploadIntent, isRecordingType, estimateProcessingSec } from "@/lib/uploads";
import { parseYouTubeId, canonicalYouTubeUrl, fetchYouTubeMeta } from "@/lib/media/ffmpeg";
import { enqueue } from "@/lib/queue";

type Ctx = { params: { studySetId: string } };

const addSourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("file"),
    filename: z.string().min(1).max(255),
    mimeType: z.string().min(3),
    sizeBytes: z.number().int().positive(),
    title: z.string().max(200).optional(),
    consent: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("youtube"),
    url: z.string().url(),
    consent: z.literal(true),
    title: z.string().max(200).optional(),
  }),
]);

export const GET = apiHandler<Ctx>(async (_req, { params }) => {
  const session = await requireSession();
  const studySet = await assertStudySetAccess(session.user.id, params.studySetId);
  const sources = await prisma.source.findMany({
    where: { studySetId: studySet.id },
    orderBy: { createdAt: "asc" },
    include: {
      assets: { select: { id: true, kind: true, filename: true, mimeType: true, sizeBytes: true, durationSec: true } },
      transcripts: { select: { id: true, status: true, language: true, provider: true, segmentCount: true, wordCount: true } },
    },
  });
  return ok(jsonSafe({ sources }));
});

export const POST = apiHandler<Ctx>(async (req, { params }) => {
  const session = await requireSession();
  const studySet = await assertStudySetAccess(session.user.id, params.studySetId, "write");
  const input = await parseJsonBody(req, addSourceSchema);
  const storage = getStorage();

  if (input.kind === "file") {
    const { sourceType } = validateUploadIntent(input.mimeType, input.sizeBytes);
    if (isRecordingType(sourceType) && !input.consent) {
      throw badRequest("Confirm you have permission to upload and process this recording.");
    }
    const source = await prisma.source.create({
      data: {
        studySetId: studySet.id,
        type: sourceType,
        title: input.title ?? input.filename,
        status: "PENDING_UPLOAD",
        metadata: { filename: input.filename, sizeBytes: input.sizeBytes, mimeType: input.mimeType, estimatedProcessingSec: estimateProcessingSec(sourceType, input.sizeBytes) },
        ...(isRecordingType(sourceType) ? { consentConfirmedAt: new Date() } : {}),
      },
    });
    // The filename is display metadata only — never part of the storage key
    // (a "../../<otherWorkspace>/…" name used to resolve into another tenant).
    const assetKey = sourceAssetKey(studySet.workspaceId, studySet.id, source.id, input.mimeType);
    // Tickets point back at the origin this request came from, so the client
    // uploads to this server whatever port it's reachable on.
    const ticket = await storage.createUpload(assetKey, {
      contentType: input.mimeType,
      baseUrl: new URL(req.url).origin,
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
    return ok(jsonSafe({ source, upload: ticket }), { status: 201 });
  }

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
  return ok(jsonSafe({ source, jobId: job.id }), { status: 201 });
});
