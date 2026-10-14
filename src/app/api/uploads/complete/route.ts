import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiHandler, ok, parseJsonBody, requireSession, notFound, badRequest } from "@/lib/api";
import { assertStudySetAccess } from "@/lib/access";
import { getStorage } from "@/lib/storage";
import { enqueue } from "@/lib/queue";
import { validateUploadIntent } from "@/lib/uploads";

const completeSchema = z.object({ sourceId: z.string().min(1) });

/**
 * Client calls this after the PUT to its upload ticket succeeds.
 * Verifies the object exists and re-validates the declared intent before
 * queueing ingestion.
 */
export const POST = apiHandler(async (req) => {
  const session = await requireSession();
  const { sourceId } = await parseJsonBody(req, completeSchema);

  const source = await prisma.source.findUnique({ where: { id: sourceId }, include: { assets: true } });
  if (!source) throw notFound("Source");
  await assertStudySetAccess(session.user.id, source.studySetId, "write");

  const original = source.assets.find((a) => a.kind === "ORIGINAL");
  if (!original) throw badRequest("Source has no pending upload");

  // Confirm the object actually landed in storage.
  const storage = getStorage();
  try {
    const bytes = await storage.read(original.storageKey);
    if (bytes.byteLength === 0) throw new Error("empty object");
    validateUploadIntent(original.mimeType, bytes.byteLength);
  } catch (err) {
    await prisma.source.update({ where: { id: sourceId }, data: { status: "FAILED", error: "Upload verification failed — try again." } });
    throw badRequest(`Upload could not be verified: ${err instanceof Error ? err.message : "unknown error"}`);
  }

  await prisma.source.update({ where: { id: sourceId }, data: { status: "UPLOADED" } });
  const job = await prisma.generationJob.create({
    data: { studySetId: source.studySetId, sourceId, type: "INGEST_SOURCE", payload: { sourceId } },
  });
  await enqueue("ingest.source", { sourceId, generationJobId: job.id });

  return ok({ jobId: job.id, status: "PROCESSING" });
});
