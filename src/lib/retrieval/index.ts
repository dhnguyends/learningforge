import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getEmbeddings, toVectorLiteral } from "@/lib/ai/embeddings";
import type { ChunkDraft } from "@/lib/retrieval/chunking";

export interface IndexedChunk {
  id: string;
  sourceId: string;
  ordinal: number;
  kind: string;
  content: string;
  page: number | null;
  startMs: number | null;
  endMs: number | null;
}

/**
 * Persist chunks + embeddings. The vector column is written via raw SQL (pgvector).
 *
 * Embeddings are computed before any rows are written so the processing
 * dashboard can show "vectorizing" and "indexing" as distinct phases — pass
 * `onStage` to receive the transitions.
 */
export async function indexChunks(
  sourceId: string,
  drafts: ChunkDraft[],
  onStage?: (stage: "vectorizing" | "indexing", progress: number) => Promise<void>,
): Promise<IndexedChunk[]> {
  if (drafts.length === 0) return [];

  await onStage?.("vectorizing", 80);
  const vectors = await getEmbeddings().embed(drafts.map((d) => d.content));
  // createManyAndReturn does not guarantee row order — match vectors to rows
  // via the per-source unique ordinal instead of index.
  const vectorByOrdinal = new Map(drafts.map((d, i) => [d.ordinal, vectors[i]]));

  await onStage?.("indexing", 90);
  await prisma.extractedChunk.deleteMany({ where: { sourceId } });
  const created = await prisma.extractedChunk.createManyAndReturn({
    data: drafts.map((d) => ({
      sourceId,
      ordinal: d.ordinal,
      kind: d.kind,
      heading: d.heading,
      content: d.content,
      page: d.page,
      startMs: d.startMs,
      endMs: d.endMs,
      speaker: d.speaker,
      tokenCount: d.tokenCount,
    })),
  });
  for (const row of created) {
    const vector = vectorByOrdinal.get(row.ordinal);
    if (!vector) throw new Error(`Missing embedding for chunk ordinal ${row.ordinal} (source ${sourceId})`);
    await prisma.$executeRawUnsafe(
      `UPDATE "extracted_chunks" SET embedding = $1::vector WHERE id = $2`,
      toVectorLiteral(vector),
      row.id,
    );
  }

  return created.map((c) => ({
    id: c.id,
    sourceId: c.sourceId,
    ordinal: c.ordinal,
    kind: c.kind,
    content: c.content,
    page: c.page,
    startMs: c.startMs,
    endMs: c.endMs,
  }));
}

export interface RetrievedChunk {
  id: string;
  sourceId: string;
  sourceType: string;
  sourceTitle: string;
  ordinal: number;
  kind: string;
  content: string;
  heading: string | null;
  page: number | null;
  startMs: number | null;
  endMs: number | null;
  score: number;
}

/** Hybrid retrieval: cosine similarity via pgvector, scoped to a study set. */
export async function searchChunks(
  studySetId: string,
  query: string,
  { k = 8, sourceIds, minScore = 0.05 }: { k?: number; sourceIds?: string[]; minScore?: number } = {},
): Promise<RetrievedChunk[]> {
  const [vector] = await getEmbeddings().embed([query]);
  const literal = toVectorLiteral(vector);

  const sourceFilter = sourceIds?.length
    ? Prisma.sql`AND s."id" IN (${Prisma.join(sourceIds)})`
    : Prisma.empty;

  const rows = await prisma.$queryRaw<RetrievedChunkRow[]>(Prisma.sql`
    SELECT c."id", c."sourceId", c."ordinal", c."kind", c."content", c."heading",
           c."page", c."startMs", c."endMs",
           s."type" AS "sourceType", s."title" AS "sourceTitle",
           1 - (c."embedding" <=> ${literal}::vector) AS "score"
    FROM "extracted_chunks" c
    JOIN "sources" s ON s."id" = c."sourceId"
    WHERE s."studySetId" = ${studySetId}
      AND s."status" = 'READY'
      AND c."embedding" IS NOT NULL
      ${sourceFilter}
    ORDER BY c."embedding" <=> ${literal}::vector
    LIMIT ${k}
  `);

  return rows
    .filter((r) => Number(r.score) >= minScore)
    .map((r) => ({ ...r, score: Number(r.score) }));
}

/**
 * Error for generators when retrieval came back empty. Distinguishes "nothing
 * indexed yet" (processing genuinely still pending) from "chunks are indexed
 * but none matched" — the latter usually means the study set's title/subject
 * shares no vocabulary with the source material (typical in offline mock
 * embeddings, e.g. French metadata over English documents), and telling the
 * user to "wait for processing" would point at something already finished.
 */
export async function emptyRetrievalError(studySetId: string): Promise<Error> {
  const indexedChunks = await prisma.extractedChunk.count({
    where: { source: { studySetId, status: "READY" } },
  });
  if (indexedChunks === 0) {
    return new Error("No indexed sources yet — add sources and wait for processing to finish.");
  }
  return new Error(
    `Retrieval matched none of the ${indexedChunks} indexed chunk(s) for this study set — ` +
      "the set's title/subject may share no vocabulary with the source material " +
      "(common with offline mock embeddings); check the language of both, or configure a real embeddings provider.",
  );
}

interface RetrievedChunkRow {
  id: string;
  sourceId: string;
  ordinal: number;
  kind: string;
  content: string;
  heading: string | null;
  page: number | null;
  startMs: number | null;
  endMs: number | null;
  sourceType: string;
  sourceTitle: string;
  score: number | Prisma.Decimal;
}

/** Build the compact "context block" fed to generation prompts. */
export function formatRetrievedContext(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return "(no indexed source content found)";
  return chunks
    .map((c, i) => {
      const loc =
        c.startMs != null
          ? `${Math.floor(c.startMs / 60000)}:${String(Math.floor((c.startMs % 60000) / 1000)).padStart(2, "0")}`
          : c.page != null
            ? `page ${c.page}`
            : "no location";
      return `[CHUNK ${i + 1}] (id=${c.id}, source="${c.sourceTitle}", ${loc})\n${c.content}`;
    })
    .join("\n\n");
}
