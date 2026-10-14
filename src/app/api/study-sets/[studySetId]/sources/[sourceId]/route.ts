import { z } from "zod";
import { prisma, jsonSafe } from "@/lib/db";
import { apiHandler, ok, parseJsonBody, requireSession, notFound } from "@/lib/api";
import { assertStudySetAccess } from "@/lib/access";
import { getStorage } from "@/lib/storage";
import { audit } from "@/lib/audit";

type Ctx = { params: { studySetId: string; sourceId: string } };

export const GET = apiHandler<Ctx>(async (req, { params }) => {
  const session = await requireSession();
  const studySet = await assertStudySetAccess(session.user.id, params.studySetId);

  const source = await prisma.source.findFirst({
    where: { id: params.sourceId, studySetId: studySet.id },
    include: {
      assets: true,
      transcripts: { include: { segments: { orderBy: { idx: "asc" } } } },
    },
  });
  if (!source) throw notFound("Source");

  const storage = getStorage();
  const originalAsset = source.assets.find((a) => a.kind === "ORIGINAL");
  const playbackAsset =
    source.type === "AUDIO"
      ? originalAsset
      : source.type === "VIDEO"
        ? originalAsset
        : source.assets.find((a) => a.kind === "AUDIO") ?? originalAsset;

  const assetUrls: Record<string, string> = {};
  const origin = new URL(req.url).origin;
  for (const asset of source.assets) {
    assetUrls[asset.id] = await storage.readUrl(asset.storageKey, undefined, origin);
  }

  return ok(
    jsonSafe({
      source: {
        ...source,
        playbackUrl: playbackAsset ? assetUrls[playbackAsset.id] : null,
        playbackKind: source.type === "VIDEO" ? "video" : source.type === "YOUTUBE" ? "youtube" : source.type === "AUDIO" ? "audio" : "document",
        assetUrls,
      },
    }),
  );
});

const patchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
});

export const PATCH = apiHandler<Ctx>(async (req, { params }) => {
  const session = await requireSession();
  const studySet = await assertStudySetAccess(session.user.id, params.studySetId, "write");
  const body = await parseJsonBody(req, patchSchema);
  const source = await prisma.source.updateMany({
    where: { id: params.sourceId, studySetId: studySet.id },
    data: {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
    },
  });
  if (!source.count) throw notFound("Source");
  return ok({ updated: true });
});

/** Permanent source deletion: storage objects + all derived data (cascade). */
export const DELETE = apiHandler<Ctx>(async (_req, { params }) => {
  const session = await requireSession();
  const studySet = await assertStudySetAccess(session.user.id, params.studySetId, "write");
  const source = await prisma.source.findFirst({ where: { id: params.sourceId, studySetId: studySet.id } });
  if (!source) throw notFound("Source");

  await getStorage().deletePrefix(`workspaces/${studySet.workspaceId}/study-sets/${studySet.id}/sources/${source.id}`);
  await prisma.source.delete({ where: { id: source.id } });
  await audit({ userId: session.user.id, action: "source.delete", entityType: "source", entityId: source.id });
  return ok({ deleted: true });
});
