/**
 * Recreate the HNSW vector index that `prisma db push` drops (Prisma cannot
 * declare an index on the Unsupported("vector") column, so it treats it as
 * drift). Run automatically by `npm run db:push` and `npm run db:setup`.
 * Keep the statement identical to CREATE_VECTOR_INDEX_SQL in
 * src/lib/vector-index.ts (a unit test checks it).
 *
 * Usage: node scripts/ensure-vector-index.mjs   (reads DATABASE_URL from .env)
 */
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { Client } from "pg";

export const CREATE_VECTOR_INDEX_SQL =
  `CREATE INDEX IF NOT EXISTS extracted_chunks_embedding_idx ON "extracted_chunks" USING hnsw ("embedding" vector_cosine_ops)`;

function loadEnv() {
  if (!existsSync(".env")) return;
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const value = m[2].replace(/^["']|["']$/g, "");
    if (!process.env[m[1]]) process.env[m[1]] = value;
  }
}

export async function ensureVectorIndex(connectionString) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(CREATE_VECTOR_INDEX_SQL);
  } finally {
    await client.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  loadEnv();
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }
  await ensureVectorIndex(process.env.DATABASE_URL);
  console.log("✓ HNSW cosine index on extracted_chunks.embedding");
}
