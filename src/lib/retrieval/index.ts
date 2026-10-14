import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getEmbeddings, retrievalMinScore, toVectorLiteral } from "@/lib/ai/embeddings";
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
  const embeddings = getEmbeddings();
  const vectors = await embeddings.embed(drafts.map((d) => d.content), { kind: "document" });
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
      embeddingModel: embeddings.name,
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
  { k = 8, sourceIds, minScore = retrievalMinScore() }: { k?: number; sourceIds?: string[]; minScore?: number } = {},
): Promise<RetrievedChunk[]> {
  const embeddings = getEmbeddings();
  const [vector] = await embeddings.embed([query], { kind: "query" });
  const literal = toVectorLiteral(vector);
  // Only compare vectors from the same model: cosine scores across vector
  // spaces are meaningless (legacy rows without a tag are mock-hash).
  const modelFilter =
    embeddings.name === "mock-hash"
      ? Prisma.sql`AND (c."embeddingModel" = ${embeddings.name} OR c."embeddingModel" IS NULL)`
      : Prisma.sql`AND c."embeddingModel" = ${embeddings.name}`;

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
      ${modelFilter}
      ${sourceFilter}
    ORDER BY c."embedding" <=> ${literal}::vector
    LIMIT ${k}
  `);

  return rows
    .filter((r) => Number(r.score) >= minScore)
    .map((r) => ({ ...r, score: Number(r.score) }));
}

/**
 * Retrieval for artifacts that cover the WHOLE study set (study guide, and
 * flashcards / quizzes / exercises requested without a topic).
 *
 * Similarity search alone is the wrong tool there: the only "query" is the
 * set's title/subject, which need not share vocabulary — or even a language —
 * with the material (a French-titled set over an English PDF matched nothing
 * and every guide generation failed). Ranked matches come first; the rest of
 * the `k` budget is filled with chunks sampled evenly across every READY
 * source (score 0), so generation always sees representative content once
 * anything is indexed. Returns [] only when nothing is indexed yet.
 */
export async function retrieveForWholeSet(
  studySetId: string,
  query: string,
  { k, sourceIds }: { k: number; sourceIds?: string[] },
): Promise<RetrievedChunk[]> {
  const ranked = await searchChunks(studySetId, query, { k, sourceIds });
  if (ranked.length >= k) return ranked;

  const taken = new Set(ranked.map((c) => c.id));
  const candidates = await prisma.extractedChunk.findMany({
    where: {
      source: { studySetId, status: "READY", ...(sourceIds?.length ? { id: { in: sourceIds } } : {}) },
      id: { notIn: [...taken] },
    },
    select: { id: true, sourceId: true, ordinal: true },
    orderBy: [{ sourceId: "asc" }, { ordinal: "asc" }],
  });
  const sampledIds = sampleForCoverage(candidates, k - ranked.length).map((c) => c.id);
  if (sampledIds.length === 0) return ranked;

  const rows = await prisma.extractedChunk.findMany({
    where: { id: { in: sampledIds } },
    include: { source: { select: { type: true, title: true } } },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const sampled: RetrievedChunk[] = sampledIds
    .map((id) => byId.get(id))
    .filter((r): r is (typeof rows)[number] => Boolean(r))
    .map((r) => ({
      id: r.id,
      sourceId: r.sourceId,
      sourceType: r.source.type,
      sourceTitle: r.source.title,
      ordinal: r.ordinal,
      kind: r.kind,
      content: r.content,
      heading: r.heading,
      page: r.page,
      startMs: r.startMs,
      endMs: r.endMs,
      score: 0,
    }));
  return [...ranked, ...sampled];
}

/**
 * Pick up to `limit` chunks spread evenly over sources (round-robin quota per
 * source) and, within each source, evenly over its ordinals — so a 3-hour
 * lecture contributes its beginning, middle and end, not just its intro.
 * Pure; result is grouped by source in ordinal order.
 */
export function sampleForCoverage<T extends { sourceId: string; ordinal: number }>(chunks: T[], limit: number): T[] {
  if (limit <= 0 || chunks.length === 0) return [];
  const bySource = new Map<string, T[]>();
  for (const c of chunks) {
    const list = bySource.get(c.sourceId) ?? [];
    list.push(c);
    bySource.set(c.sourceId, list);
  }
  const groups = [...bySource.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, list]) => list.sort((a, b) => a.ordinal - b.ordinal));

  const quota = groups.map(() => 0);
  let remaining = Math.min(limit, chunks.length);
  while (remaining > 0) {
    let progressed = false;
    for (let i = 0; i < groups.length && remaining > 0; i++) {
      if (quota[i] < groups[i].length) {
        quota[i]++;
        remaining--;
        progressed = true;
      }
    }
    if (!progressed) break;
  }

  const out: T[] = [];
  groups.forEach((list, i) => {
    const q = quota[i];
    for (let j = 0; j < q; j++) out.push(list[Math.floor(((j + 0.5) * list.length) / q)]);
  });
  return out;
}

/**
 * Error for generators when retrieval came back empty. Distinguishes "nothing
 * indexed yet" (processing genuinely still pending) from "chunks are indexed
 * but none matched" — since whole-set generation uses retrieveForWholeSet, the
 * latter only happens for an explicit topic that shares no vocabulary with the
 * source material (typical with offline mock embeddings), and telling the user
 * to "wait for processing" would point at something already finished.
 */
export async function emptyRetrievalError(studySetId: string): Promise<Error> {
  const indexedChunks = await prisma.extractedChunk.count({
    where: { source: { studySetId, status: "READY" } },
  });
  if (indexedChunks === 0) {
    return new Error("No indexed sources yet — add sources and wait for processing to finish.");
  }
  const model = getEmbeddings().name;
  const current = await prisma.extractedChunk.count({
    where: {
      source: { studySetId, status: "READY" },
      ...(model === "mock-hash" ? { OR: [{ embeddingModel: model }, { embeddingModel: null }] } : { embeddingModel: model }),
    },
  });
  if (current === 0) {
    return new Error(
      `This study set's ${indexedChunks} chunk(s) were embedded with a different embeddings model than the configured "${model}" — ` +
        "run `npx tsx scripts/reembed.ts` (or re-add the sources) to rebuild the vector index.",
    );
  }
  return new Error(
    `Retrieval matched none of the ${indexedChunks} indexed chunk(s) for the requested topic — ` +
      "it may share no vocabulary with the source material " +
      "(common with offline mock embeddings); rephrase it in the sources' own terms and language, leave the topic empty to cover the whole set, or configure a real embeddings provider.",
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
