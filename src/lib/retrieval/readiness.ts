import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getEmbeddings } from "@/lib/ai/embeddings";
import { mockProvidersAllowed } from "@/lib/env";

/**
 * Is a study set fully imported, i.e. every source READY and every chunk
 * vectorized with the current embeddings model (so semantic search sees all of
 * it)? Generation — study guide, flashcards, quiz, exercises — waits for this:
 * generating from a half-imported set silently leaves material out.
 */
export interface IndexingReadiness {
  ready: boolean;
  sources: { total: number; ready: number; processing: number; failed: number };
  /** Chunks of READY sources not searchable yet (no vector, or another embeddings model). */
  pendingChunks: number;
  /** Sources whose transcript is placeholder text from the mock provider. */
  placeholderSources: number;
  /** Why generation is blocked; null when ready. */
  reason: string | null;
}

export async function getIndexingReadiness(studySetId: string): Promise<IndexingReadiness> {
  const sources = await prisma.source.findMany({ where: { studySetId }, select: { status: true } });
  const counts = {
    total: sources.length,
    ready: sources.filter((s) => s.status === "READY").length,
    processing: sources.filter((s) => s.status === "PENDING_UPLOAD" || s.status === "UPLOADED" || s.status === "PROCESSING").length,
    failed: sources.filter((s) => s.status === "FAILED").length,
  };

  const model = getEmbeddings().name;
  // Same rule as searchChunks: legacy untagged rows belong to mock-hash.
  const current =
    model === "mock-hash"
      ? Prisma.sql`(c."embeddingModel" = ${model} OR c."embeddingModel" IS NULL)`
      : Prisma.sql`c."embeddingModel" = ${model}`;
  const [row] = await prisma.$queryRaw<{ searchable: bigint; pending: bigint }[]>(Prisma.sql`
    SELECT COUNT(*) FILTER (WHERE c."embedding" IS NOT NULL AND ${current}) AS "searchable",
           COUNT(*) FILTER (WHERE c."embedding" IS NULL OR NOT ${current})   AS "pending"
    FROM "extracted_chunks" c
    JOIN "sources" s ON s."id" = c."sourceId"
    WHERE s."studySetId" = ${studySetId} AND s."status" = 'READY'
  `);
  const searchable = Number(row?.searchable ?? 0);
  const pendingChunks = Number(row?.pending ?? 0);
  // Placeholder transcripts (imported while transcription was a mock) must not
  // be studied from; tests and demos allow them.
  const placeholderSources = mockProvidersAllowed()
    ? 0
    : await prisma.source.count({ where: { studySetId, transcripts: { some: { provider: "mock" } } } });

  let reason: string | null = null;
  if (counts.total === 0) {
    reason = "Add at least one source first.";
  } else if (counts.processing > 0) {
    reason = `Importing sources: ${counts.ready} of ${counts.total} ready. Generation starts once every source is vectorized and indexed.`;
  } else if (counts.failed > 0) {
    reason = `${counts.failed} source${counts.failed > 1 ? "s" : ""} failed to import. Retry or remove ${counts.failed > 1 ? "them" : "it"} before generating.`;
  } else if (placeholderSources > 0) {
    reason = `${placeholderSources} source${placeholderSources > 1 ? "s have" : " has"} a placeholder transcript (imported before transcription was set up) — use "Import again" on ${placeholderSources > 1 ? "them" : "it"} first.`;
  } else if (pendingChunks > 0) {
    reason = `${pendingChunks} passage${pendingChunks > 1 ? "s are" : " is"} not indexed for the current embeddings model "${model}" — run \`npx tsx scripts/reembed.ts\`.`;
  } else if (searchable === 0) {
    reason = "The sources contain no extractable text to generate from.";
  }

  return { ready: reason === null, sources: counts, pendingChunks, placeholderSources, reason };
}
