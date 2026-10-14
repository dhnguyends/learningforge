/**
 * One-off storage-key migration (REVIEW-REPORT.md S3 + S5).
 *
 *   npx tsx scripts/migrate-storage-keys.ts           # dry run: report only
 *   npx tsx scripts/migrate-storage-keys.ts --apply   # perform the changes
 *
 * 1. Derived assets (extracted / YouTube audio) written outside their tenant
 *    prefix (`<sourceId>/audio.mp3`) are moved under
 *    `workspaces/<ws>/study-sets/<set>/sources/<id>/`, so deletion purges them
 *    and /api/files can authorize them.
 * 2. ORIGINAL assets whose key escapes the source prefix were created from a
 *    client filename (possibly a `../` traversal into another tenant). Their
 *    bytes are NOT copied — they may belong to someone else. The source is
 *    reset to FAILED, its transcripts/chunks (derived from those bytes) are
 *    purged, and the key is pointed at the canonical location.
 * 3. Audio-recap keys stored outside the study-set prefix are moved under it.
 */
import { prisma } from "@/lib/db";
import {
  getStorage,
  assertSafeKey,
  sourceAssetKey,
  sourceDerivedKey,
  sourcePrefix,
  studySetPrefix,
  studySetRecapKey,
} from "@/lib/storage";

const apply = process.argv.includes("--apply");
const storage = getStorage();

function isSafe(key: string): boolean {
  try {
    assertSafeKey(key);
    return true;
  } catch {
    return false;
  }
}

async function move(from: string, to: string, contentType: string): Promise<"moved" | "missing" | "unreadable"> {
  if (!isSafe(from)) return "unreadable";
  let bytes: Buffer;
  try {
    bytes = await storage.read(from);
  } catch {
    return "missing";
  }
  await storage.put(to, bytes, { contentType });
  await storage.delete(from);
  return "moved";
}

async function main() {
  console.log(`[migrate-storage-keys] ${apply ? "APPLY" : "DRY RUN"} (driver: ${storage.name})`);
  let moved = 0;
  let reset = 0;

  const assets = await prisma.sourceAsset.findMany({
    include: { source: { select: { id: true, studySetId: true, status: true, studySet: { select: { workspaceId: true } } } } },
  });

  for (const asset of assets) {
    const { source } = asset;
    const prefix = sourcePrefix(source.studySet.workspaceId, source.studySetId, source.id);
    if (isSafe(asset.storageKey) && asset.storageKey.startsWith(`${prefix}/`)) continue;

    if (asset.kind === "ORIGINAL") {
      const canonical = sourceAssetKey(source.studySet.workspaceId, source.studySetId, source.id, asset.mimeType);
      console.warn(`  ! ORIGINAL ${asset.id} (source ${source.id}) key escapes its prefix: ${asset.storageKey}`);
      console.warn(`    -> reset source to FAILED, purge its transcripts/chunks, key := ${canonical}`);
      reset++;
      if (apply) {
        await prisma.$transaction([
          prisma.extractedChunk.deleteMany({ where: { sourceId: source.id } }),
          prisma.transcript.deleteMany({ where: { sourceId: source.id } }),
          prisma.sourceAsset.deleteMany({ where: { sourceId: source.id, kind: { not: "ORIGINAL" } } }),
          prisma.sourceAsset.update({ where: { id: asset.id }, data: { storageKey: canonical } }),
          prisma.source.update({
            where: { id: source.id },
            data: { status: "FAILED", error: "Upload location was invalid and has been reset — re-add this file." },
          }),
        ]);
      }
      continue;
    }

    const target =
      asset.kind === "AUDIO"
        ? sourceDerivedKey(source.studySet.workspaceId, source.studySetId, source.id, "audio.mp3")
        : `${prefix}/${asset.kind.toLowerCase()}-${asset.id}`;
    console.log(`  ~ ${asset.kind} ${asset.id}: ${asset.storageKey} -> ${target}`);
    moved++;
    if (apply) {
      const outcome = await move(asset.storageKey, target, asset.mimeType);
      if (outcome !== "moved") console.warn(`    (object ${outcome}; updating the key only)`);
      await prisma.sourceAsset.update({ where: { id: asset.id }, data: { storageKey: target } });
    }
  }

  const guides = await prisma.studyGuide.findMany({ include: { studySet: { select: { id: true, workspaceId: true } } } });
  for (const guide of guides) {
    const metadata = (guide.metadata ?? {}) as Record<string, unknown>;
    const recap = metadata.recap as { audioKey?: string | null } | undefined;
    const key = recap?.audioKey;
    if (!key || (isSafe(key) && key.startsWith(`${studySetPrefix(guide.studySet.workspaceId, guide.studySet.id)}/`))) continue;
    const target = studySetRecapKey(guide.studySet.workspaceId, guide.studySet.id, guide.id, Date.now());
    console.log(`  ~ RECAP ${guide.id}: ${key} -> ${target}`);
    moved++;
    if (apply) {
      const outcome = await move(key, target, "audio/mpeg");
      if (outcome !== "moved") console.warn(`    (object ${outcome}; updating the key only)`);
      await prisma.studyGuide.update({
        where: { id: guide.id },
        data: { metadata: { ...metadata, recap: { ...recap, audioKey: target } } as object },
      });
    }
  }

  console.log(`[migrate-storage-keys] ${moved} object(s) to move, ${reset} source(s) to reset${apply ? " — done" : " — re-run with --apply"}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
