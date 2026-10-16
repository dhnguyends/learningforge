import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { getEmbeddings, retrievalMinScore } from "@/lib/ai/embeddings";
import { getStorage } from "@/lib/storage";
import { MAX_TOKENS, TARGET_TOKENS } from "@/lib/retrieval/chunking";
import { vectorIndexStatus, type VectorIndexStatus } from "@/lib/vector-index";

/**
 * Read-only figures for the admin Database tab: how big the database and the
 * stored files are, how sources were segmented into passages, and what the
 * embeddings look like. Everything comes from PostgreSQL / pgvector
 * statistics and the storage driver; nothing is modified.
 */
export interface DatabaseStats {
  generatedAt: string;
  database: { name: string; sizeBytes: number; postgresVersion: string; pgvectorVersion: string | null };
  files: { driver: string; objects: number; sizeBytes: number | null };
  counts: { studySets: number; sources: number; passages: number; embedded: number; tokens: number };
  segmentation: {
    targetTokens: number;
    maxTokens: number;
    minTokens: number;
    avgTokens: number;
    p95Tokens: number;
    largestTokens: number;
    bySourceType: { type: string; sources: number; passages: number; tokens: number }[];
    byCourse: { id: string; title: string; owner: string; sources: number; passages: number; tokens: number; vectorBytes: number }[];
  };
  embeddings: {
    provider: string;
    model: string;
    nativeDimensions: number | null;
    storedDimensions: number | null;
    bytesPerVector: number | null;
    totalVectorBytes: number;
    metric: string;
    minScore: number;
    byModel: { model: string; passages: number; current: boolean }[];
    missing: number;
    stale: number;
  };
  index: VectorIndexStatus;
  tables: { name: string; rows: number; totalBytes: number; dataBytes: number; indexBytes: number; overflowBytes: number }[];
}

/** Dimensions the embeddings model itself produces (vectors are zero-padded to the column size). */
const NATIVE_DIMENSIONS: Record<string, number> = {
  "ollama:embeddinggemma": 768,
  "openai:text-embedding-3-small": 1536,
  "openai:text-embedding-3-large": 3072,
};

const n = (v: unknown) => Number(v ?? 0);

export async function getDatabaseStats(): Promise<DatabaseStats> {
  const embeddings = getEmbeddings();
  const model = embeddings.name;

  const [[db], [ext], [chunks], percentiles, bySourceType, byCourse, byModel, [vec], tables, studySets, sources] = await Promise.all([
    prisma.$queryRawUnsafe<{ name: string; size: bigint; version: string }[]>(
      `SELECT current_database() AS name, pg_database_size(current_database()) AS size, current_setting('server_version') AS version`,
    ),
    prisma.$queryRawUnsafe<{ version: string }[]>(`SELECT extversion AS version FROM pg_extension WHERE extname = 'vector'`).then((r) => (r.length ? r : [{ version: null as unknown as string }])),
    prisma.$queryRawUnsafe<{ passages: bigint; embedded: bigint; tokens: bigint; min: number | null; avg: number | null; max: number | null }[]>(
      `SELECT count(*) AS passages, count(embedding) AS embedded, coalesce(sum("tokenCount"), 0) AS tokens,
              min("tokenCount") AS min, avg("tokenCount")::float AS avg, max("tokenCount") AS max
       FROM extracted_chunks`,
    ),
    prisma.$queryRawUnsafe<{ p95: number | null }[]>(
      `SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY "tokenCount")::float AS p95 FROM extracted_chunks`,
    ),
    prisma.$queryRawUnsafe<{ type: string; sources: bigint; passages: bigint; tokens: bigint }[]>(
      `SELECT s."type"::text AS type, count(DISTINCT s.id) AS sources, count(c.id) AS passages, coalesce(sum(c."tokenCount"), 0) AS tokens
       FROM sources s LEFT JOIN extracted_chunks c ON c."sourceId" = s.id
       GROUP BY s."type" ORDER BY passages DESC`,
    ),
    prisma.$queryRawUnsafe<{ id: string; title: string; owner: string; sources: bigint; passages: bigint; tokens: bigint; vector_bytes: bigint }[]>(
      `SELECT ss.id, ss.title, coalesce(u.name, u.email) AS owner,
              count(DISTINCT s.id) AS sources, count(c.id) AS passages,
              coalesce(sum(c."tokenCount"), 0) AS tokens, coalesce(sum(pg_column_size(c.embedding)), 0) AS vector_bytes
       FROM study_sets ss
       JOIN workspaces w ON w.id = ss."workspaceId"
       JOIN users u ON u.id = w."ownerId"
       LEFT JOIN sources s ON s."studySetId" = ss.id
       LEFT JOIN extracted_chunks c ON c."sourceId" = s.id
       GROUP BY ss.id, ss.title, u.name, u.email
       ORDER BY passages DESC, ss.title`,
    ),
    prisma.$queryRawUnsafe<{ model: string | null; passages: bigint }[]>(
      `SELECT "embeddingModel" AS model, count(*) AS passages FROM extracted_chunks WHERE embedding IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`,
    ),
    prisma.$queryRawUnsafe<{ dims: number | null; bytes: number | null; total: bigint }[]>(
      `SELECT max(vector_dims(embedding)) AS dims, avg(pg_column_size(embedding))::int AS bytes,
              coalesce(sum(pg_column_size(embedding)), 0) AS total
       FROM extracted_chunks WHERE embedding IS NOT NULL`,
    ),
    prisma.$queryRawUnsafe<{ name: string; rows: bigint; total: bigint; data: bigint; indexes: bigint }[]>(
      `SELECT c.relname AS name, greatest(c.reltuples, 0)::bigint AS rows,
              pg_total_relation_size(c.oid) AS total, pg_relation_size(c.oid) AS data, pg_indexes_size(c.oid) AS indexes
       FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
       WHERE ns.nspname = 'public' AND c.relkind = 'r'
       ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 12`,
    ),
    prisma.studySet.count(),
    prisma.source.count(),
  ]);

  const index = await vectorIndexStatus();
  const files = await storedFiles();
  const isCurrent = (m: string | null) => (model === "mock-hash" ? m === model || m === null : m === model);
  const modelRows = byModel.map((r) => ({ model: r.model ?? "(untagged — mock-hash)", passages: n(r.passages), current: isCurrent(r.model) }));

  return {
    generatedAt: new Date().toISOString(),
    database: { name: db.name, sizeBytes: n(db.size), postgresVersion: db.version, pgvectorVersion: ext?.version ?? null },
    files,
    counts: { studySets, sources, passages: n(chunks.passages), embedded: n(chunks.embedded), tokens: n(chunks.tokens) },
    segmentation: {
      targetTokens: TARGET_TOKENS,
      maxTokens: MAX_TOKENS,
      minTokens: n(chunks.min),
      avgTokens: Math.round(n(chunks.avg)),
      p95Tokens: Math.round(n(percentiles[0]?.p95)),
      largestTokens: n(chunks.max),
      bySourceType: bySourceType.map((r) => ({ type: r.type, sources: n(r.sources), passages: n(r.passages), tokens: n(r.tokens) })),
      byCourse: byCourse.map((r) => ({
        id: r.id,
        title: r.title,
        owner: r.owner,
        sources: n(r.sources),
        passages: n(r.passages),
        tokens: n(r.tokens),
        vectorBytes: n(r.vector_bytes),
      })),
    },
    embeddings: {
      provider: getEnv().EMBEDDINGS_PROVIDER,
      model,
      nativeDimensions: NATIVE_DIMENSIONS[model] ?? (vec?.dims ?? null),
      storedDimensions: vec?.dims ?? null,
      bytesPerVector: vec?.bytes ?? null,
      totalVectorBytes: n(vec?.total),
      metric: "cosine",
      minScore: retrievalMinScore(),
      byModel: modelRows,
      missing: n(chunks.passages) - n(chunks.embedded),
      stale: modelRows.filter((r) => !r.current).reduce((sum, r) => sum + r.passages, 0),
    },
    index,
    tables: tables.map((t) => ({
      name: t.name,
      rows: n(t.rows),
      totalBytes: n(t.total),
      dataBytes: n(t.data),
      indexBytes: n(t.indexes),
      overflowBytes: Math.max(0, n(t.total) - n(t.data) - n(t.indexes)),
    })),
  };
}

/** Uploaded originals and derived files (audio, recaps) — kept outside the database. */
async function storedFiles(): Promise<DatabaseStats["files"]> {
  const storage = getStorage();
  const usage = await storage.usage("workspaces").catch(() => null);
  return { driver: storage.name, objects: usage?.objects ?? 0, sizeBytes: usage?.bytes ?? null };
}
