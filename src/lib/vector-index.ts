import { prisma } from "@/lib/db";

/**
 * The HNSW index behind semantic search (cosine distance on
 * extracted_chunks.embedding). Prisma cannot declare it (the column is
 * `Unsupported("vector(1536)")`), so `prisma db push` drops it as schema drift.
 * `npm run db:push` and `npm run db:setup` recreate it with
 * scripts/ensure-vector-index.mjs (same statement), the admin Database tab
 * can rebuild it, and the server warns at startup when it is missing.
 */
export const VECTOR_INDEX_NAME = "extracted_chunks_embedding_idx";
export const CREATE_VECTOR_INDEX_SQL = `CREATE INDEX IF NOT EXISTS ${VECTOR_INDEX_NAME} ON "extracted_chunks" USING hnsw ("embedding" vector_cosine_ops)`;

export interface VectorIndexStatus {
  present: boolean;
  valid: boolean;
  method: string | null;
  sizeBytes: number;
  definition: string | null;
  /** HNSW build parameters (pgvector defaults: m=16, ef_construction=64). */
  m: number;
  efConstruction: number;
}

export async function vectorIndexStatus(): Promise<VectorIndexStatus> {
  const rows = await prisma.$queryRawUnsafe<
    { method: string; size: bigint; definition: string; valid: boolean; options: string[] | null }[]
  >(
    `SELECT am.amname AS method, pg_relation_size(i.oid) AS size, pg_get_indexdef(i.oid) AS definition,
            x.indisvalid AS valid, i.reloptions AS options
     FROM pg_class i
     JOIN pg_index x ON x.indexrelid = i.oid
     JOIN pg_am am ON am.oid = i.relam
     WHERE i.relname = $1`,
    VECTOR_INDEX_NAME,
  );
  const row = rows[0];
  const option = (key: string, fallback: number) => {
    const found = row?.options?.find((o) => o.startsWith(`${key}=`));
    return found ? Number(found.split("=")[1]) : fallback;
  };
  return {
    present: Boolean(row),
    valid: row?.valid ?? false,
    method: row?.method ?? null,
    sizeBytes: Number(row?.size ?? 0),
    definition: row?.definition ?? null,
    m: option("m", 16),
    efConstruction: option("ef_construction", 64),
  };
}

/**
 * Creates the index when it is missing, or rebuilds it (also repairing an
 * index left invalid by an interrupted build). CONCURRENTLY keeps searches and
 * imports running meanwhile; it cannot run inside a transaction.
 */
export async function rebuildVectorIndex(): Promise<VectorIndexStatus> {
  const before = await vectorIndexStatus();
  if (before.present && !before.valid) {
    await prisma.$executeRawUnsafe(`DROP INDEX CONCURRENTLY IF EXISTS ${VECTOR_INDEX_NAME}`);
  }
  if (before.present && before.valid) {
    await prisma.$executeRawUnsafe(`REINDEX INDEX CONCURRENTLY ${VECTOR_INDEX_NAME}`);
  } else {
    await prisma.$executeRawUnsafe(CREATE_VECTOR_INDEX_SQL.replace("CREATE INDEX IF NOT EXISTS", "CREATE INDEX CONCURRENTLY IF NOT EXISTS"));
  }
  return vectorIndexStatus();
}

let warned = false;

/** Once per server process: log loudly if semantic search runs without its index. */
export async function warnIfVectorIndexMissing(): Promise<void> {
  if (warned) return;
  warned = true;
  try {
    const status = await vectorIndexStatus();
    if (!status.present || !status.valid) {
      console.warn(
        `[vector-index] ${VECTOR_INDEX_NAME} is ${status.present ? "invalid" : "missing"}: semantic search scans every passage. ` +
          "Rebuild it at /admin → Database, or run `npm run db:push`.",
      );
    }
  } catch (err) {
    console.error("[vector-index] check failed", err);
  }
}
