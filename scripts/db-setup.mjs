/**
 * One-shot local database setup:
 *   1. CREATE EXTENSION vector (required before prisma db push)
 *   2. npx prisma db push
 *   3. cosine index on extracted_chunks.embedding
 *
 * Usage: DATABASE_URL=... node scripts/db-setup.mjs
 */
import { execSync } from "node:child_process";
import { Client } from "pg";
import { readFileSync, existsSync } from "node:fs";

function loadEnv() {
  if (!existsSync(".env")) return;
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const value = m[2].replace(/^["']|["']$/g, "");
    if (!process.env[m[1]]) process.env[m[1]] = value;
  }
}

loadEnv();

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env first.");
  process.exit(1);
}

const url = new URL(process.env.DATABASE_URL);
console.log(`→ Setting up database ${url.pathname.replace("/", "")} on ${url.hostname}:${url.port || 5432}`);

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  await client.query(`CREATE EXTENSION IF NOT EXISTS vector`);
  console.log("✓ pgvector extension ready");
} finally {
  await client.end();
}

execSync("npx prisma db push --accept-data-loss", { stdio: "inherit" });
console.log("✓ schema pushed");

const client2 = new Client({ connectionString: process.env.DATABASE_URL });
await client2.connect();
try {
  await client2.query(`
    CREATE INDEX IF NOT EXISTS extracted_chunks_embedding_idx
    ON "extracted_chunks" USING hnsw ("embedding" vector_cosine_ops)
  `);
  console.log("✓ HNSW cosine index on extracted_chunks.embedding");
} finally {
  await client2.end();
}

console.log("\nDone. Next: npm run db:seed");
