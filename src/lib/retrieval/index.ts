import { Prisma } from "@prisma/client";
import { getEnv } from "@/lib/env";
import { prisma } from "@/lib/db";
import { getEmbeddings, retrievalMinScore, toVectorLiteral } from "@/lib/ai/embeddings";
import { estimateTokens, type ChunkDraft } from "@/lib/retrieval/chunking";

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
  language?: string | null,
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
      language: language ?? null,
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

/** Translated passages use ordinals from here on (originals never get near it). */
export const TRANSLATION_ORDINAL_OFFSET = 1_000_000;

/**
 * Stores machine translations of a source's passages as sibling rows: same
 * kind / page / timestamps as the original, `translationOfId` pointing at it,
 * and their own embeddings so a question in the other language finds them.
 * Search maps them back to the original, which is what citations point at.
 * Replaces earlier translations into the same language.
 */
export async function indexTranslations(
  sourceId: string,
  originals: IndexedChunk[],
  texts: string[],
  language: string,
): Promise<number> {
  const pairs = originals
    .map((o, i) => ({ original: o, text: (texts[i] ?? "").trim() }))
    .filter((p) => p.text.length > 0);
  await prisma.extractedChunk.deleteMany({ where: { sourceId, language, translationOfId: { not: null } } });
  if (pairs.length === 0) return 0;

  const embeddings = getEmbeddings();
  const vectors = await embeddings.embed(pairs.map((p) => p.text), { kind: "document" });
  const vectorByOriginal = new Map(pairs.map((p, i) => [p.original.id, vectors[i]]));
  const created = await prisma.extractedChunk.createManyAndReturn({
    data: pairs.map(({ original, text }) => ({
      sourceId,
      // Ordinals are unique per source: translations sit after the originals.
      ordinal: TRANSLATION_ORDINAL_OFFSET + original.ordinal,
      kind: original.kind as ChunkDraft["kind"],
      content: text,
      page: original.page,
      startMs: original.startMs,
      endMs: original.endMs,
      tokenCount: estimateTokens(text),
      embeddingModel: embeddings.name,
      language,
      translationOfId: original.id,
    })),
  });
  for (const row of created) {
    const vector = row.translationOfId ? vectorByOriginal.get(row.translationOfId) : undefined;
    if (!vector) throw new Error(`Missing embedding for translated chunk ${row.id} (source ${sourceId})`);
    await prisma.$executeRawUnsafe(
      `UPDATE "extracted_chunks" SET embedding = $1::vector WHERE id = $2`,
      toVectorLiteral(vector),
      row.id,
    );
  }
  return created.length;
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

  // Bilingual sources have a translated sibling per passage, and a question
  // often matches both: fetch twice as many, then fold translations into
  // their originals (best score wins) so each passage counts once.
  const rows = await prisma.$queryRaw<RetrievedChunkRow[]>(Prisma.sql`
    SELECT c."id", c."sourceId", c."ordinal", c."kind", c."content", c."heading",
           c."page", c."startMs", c."endMs", c."translationOfId",
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
    LIMIT ${k * 2}
  `);

  const hits = rows.filter((r) => Number(r.score) >= minScore);
  const hitById = new Map(hits.map((h) => [h.id, h]));
  const missing = [
    ...new Set(hits.map((r) => r.translationOfId).filter((id): id is string => Boolean(id) && !hitById.has(id as string))),
  ];
  const originals = missing.length
    ? await prisma.extractedChunk.findMany({
        where: { id: { in: missing } },
        include: { source: { select: { type: true, title: true } } },
      })
    : [];
  const originalById = new Map<string, Omit<RetrievedChunk, "score">>(
    originals.map((o) => [
      o.id,
      {
        id: o.id,
        sourceId: o.sourceId,
        sourceType: o.source.type,
        sourceTitle: o.source.title,
        ordinal: o.ordinal,
        kind: o.kind,
        content: o.content,
        heading: o.heading,
        page: o.page,
        startMs: o.startMs,
        endMs: o.endMs,
      },
    ]),
  );

  const best = new Map<string, RetrievedChunk>();
  for (const r of hits) {
    const score = Number(r.score);
    const target = r.translationOfId
      ? hitById.has(r.translationOfId)
        ? withoutTranslation(hitById.get(r.translationOfId)!)
        : originalById.get(r.translationOfId)
      : withoutTranslation(r);
    if (!target) continue;
    const prev = best.get(target.id);
    if (!prev || prev.score < score) best.set(target.id, { ...target, score });
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, k);
}

function withoutTranslation(r: RetrievedChunkRow): Omit<RetrievedChunk, "score"> {
  const { translationOfId: _t, score: _s, ...rest } = r;
  return rest;
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
 *
 * With a `tokenBudget` (see wholeSetTokenBudget), `k` is only a minimum: a
 * course that fits the budget is returned WHOLE, in reading order — today's
 * models take far more than 20 passages, and sampling a fifth of a course
 * leaves most of it out of its own study guide. A larger course gets as many
 * passages as the budget holds, chosen as above.
 */
export async function retrieveForWholeSet(
  studySetId: string,
  query: string,
  { k: minK, sourceIds, tokenBudget }: { k: number; sourceIds?: string[]; tokenBudget?: number },
): Promise<RetrievedChunk[]> {
  let k = minK;
  if (tokenBudget) {
    const [stats] = await prisma.$queryRaw<{ passages: bigint; tokens: bigint }[]>`
      SELECT count(c.id) AS passages, coalesce(sum(c."tokenCount"), 0) AS tokens
      FROM extracted_chunks c JOIN sources s ON s.id = c."sourceId"
      WHERE s."studySetId" = ${studySetId} AND s.status = 'READY' AND c."translationOfId" IS NULL
        ${sourceIds?.length ? Prisma.sql`AND s.id IN (${Prisma.join(sourceIds)})` : Prisma.empty}`;
    const passages = Number(stats?.passages ?? 0);
    const tokens = Number(stats?.tokens ?? 0);
    if (passages > 0 && tokens <= tokenBudget) return wholeCourse(studySetId, sourceIds);
    if (passages > 0) k = Math.max(minK, Math.floor(tokenBudget / (tokens / passages)));
  }
  const ranked = await searchChunks(studySetId, query, { k, sourceIds });
  if (ranked.length >= k) return ranked;

  const taken = new Set(ranked.map((c) => c.id));
  const candidates = await prisma.extractedChunk.findMany({
    where: {
      source: { studySetId, status: "READY", ...(sourceIds?.length ? { id: { in: sourceIds } } : {}) },
      id: { notIn: [...taken] },
      translationOfId: null,
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

/** Every READY passage of the course (or of `sourceIds`), source by source in reading order. */
async function wholeCourse(studySetId: string, sourceIds?: string[]): Promise<RetrievedChunk[]> {
  const rows = await prisma.extractedChunk.findMany({
    where: {
      source: { studySetId, status: "READY", ...(sourceIds?.length ? { id: { in: sourceIds } } : {}) },
      translationOfId: null,
    },
    include: { source: { select: { type: true, title: true, createdAt: true } } },
  });
  return rows
    .sort((a, b) => a.source.createdAt.getTime() - b.source.createdAt.getTime() || a.sourceId.localeCompare(b.sourceId) || a.ordinal - b.ordinal)
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
}

/**
 * Token budget for whole-course generation (guide outline, flashcards, quiz,
 * exercises) with the generation model in use: cloud models (Gemini, GLM) read
 * 128k-1M tokens, so a typical course fits whole; a local model on a desktop
 * GPU is far slower per token, so it gets a small budget. Mock (tests) keeps
 * the fixed passage counts.
 */
export async function wholeSetTokenBudget(): Promise<number | undefined> {
  const { getActiveAi } = await import("@/lib/ai/settings");
  const ai = await getActiveAi();
  const env = getEnv();
  if (ai.provider === "mock") return undefined;
  return ai.provider === "local" ? env.WHOLE_SET_TOKEN_BUDGET_LOCAL : env.WHOLE_SET_TOKEN_BUDGET;
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
    where: { source: { studySetId, status: "READY" }, translationOfId: null },
  });
  if (indexedChunks === 0) {
    return new Error("No indexed sources yet — add sources and wait for processing to finish.");
  }
  const model = getEmbeddings().name;
  const current = await prisma.extractedChunk.count({
    where: {
      source: { studySetId, status: "READY" },
      translationOfId: null,
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
  translationOfId: string | null;
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
