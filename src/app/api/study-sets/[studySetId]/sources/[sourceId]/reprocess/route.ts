import { prisma } from "@/lib/db";
import { apiHandler, ok, requireSession, notFound, badRequest, ApiError } from "@/lib/api";
import { assertStudySetAccess } from "@/lib/access";
import { getStorage, sourcePrefix } from "@/lib/storage";
import { enqueue } from "@/lib/queue";
import { audit } from "@/lib/audit";

type Ctx = { params: { studySetId: string; sourceId: string } };

/**
 * Re-submit a source: run the whole import again (download/extract,
 * transcribe or parse, chunk, vectorize, index) from what is already stored.
 * Used to recover a FAILED import — e.g. after updating yt-dlp or starting
 * Ollama — or to re-index with a new embeddings model. The transcript and the
 * indexed passages are replaced, not duplicated.
 */
export const POST = apiHandler<Ctx>(async (req, { params }) => {
  const session = await requireSession();
  const studySet = await assertStudySetAccess(session.user.id, params.studySetId, "write");
  const source = await prisma.source.findFirst({
    where: { id: params.sourceId, studySetId: studySet.id },
    include: { assets: true },
  });
  if (!source) throw notFound("Source");

  const running = await prisma.generationJob.findFirst({
    where: { sourceId: source.id, type: "INGEST_SOURCE", status: { in: ["QUEUED", "RUNNING"] } },
    select: { id: true },
  });
  if (running) throw new ApiError(409, "This source is already being imported", "already_processing");

  if (source.type === "YOUTUBE") {
    if (!source.externalUrl) throw badRequest("This YouTube source has no link — delete it and add the video again.");
  } else {
    // Re-import only from this source's own stored original (same rule as upload completion).
    const original = source.assets.find((a) => a.kind === "ORIGINAL");
    const ownPrefix = `${sourcePrefix(studySet.workspaceId, studySet.id, source.id)}/`;
    let stored = false;
    if (original?.storageKey.startsWith(ownPrefix)) {
      try {
        stored = (await getStorage().read(original.storageKey)).byteLength > 0;
      } catch {
        stored = false;
      }
    }
    if (!stored) throw badRequest("The original file is no longer stored — delete this source and add the file again.");
  }

  // Optional {"ocr": true}: read every page of a PDF (or the image) with OCR, for scans with a poor text layer.
  const body = (await req.json().catch(() => null)) as { ocr?: unknown } | null;
  const forceOcr = body?.ocr === true;
  if (forceOcr && source.type !== "PDF" && source.type !== "IMAGE") throw badRequest("OCR applies to PDF and image sources only.");
  await prisma.source.update({
    where: { id: source.id },
    data: {
      status: "UPLOADED",
      error: null,
      ...(forceOcr ? { metadata: { ...((source.metadata as object | null) ?? {}), ocr: "force" } } : {}),
    },
  });
  const job = await prisma.generationJob.create({
    data: { studySetId: studySet.id, sourceId: source.id, type: "INGEST_SOURCE", payload: { sourceId: source.id } },
  });
  await enqueue("ingest.source", { sourceId: source.id, generationJobId: job.id });
  await audit({ userId: session.user.id, action: "source.reprocess", entityType: "source", entityId: source.id, metadata: { previousStatus: source.status, ocr: forceOcr } });

  return ok({ jobId: job.id, status: "PROCESSING" }, { status: 202 });
});
