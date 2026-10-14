/**
 * Rebuild the vector index with the configured embeddings model.
 *
 *   npx tsx scripts/reembed.ts          # chunks whose vectors came from another model
 *   npx tsx scripts/reembed.ts --all    # every chunk
 *
 * Run after changing EMBEDDINGS_PROVIDER / OLLAMA_EMBEDDINGS_MODEL /
 * EMBEDDINGS_MODEL: cosine scores between vectors from different models are
 * meaningless, so retrieval only compares chunks tagged with the current
 * model (ExtractedChunk.embeddingModel) and untagged chunks stay invisible
 * until this script has run. Idempotent; safe to re-run.
 */
import { prisma } from "@/lib/db";
import { getEmbeddings, toVectorLiteral } from "@/lib/ai/embeddings";

const BATCH = 32;

async function main() {
  const embeddings = getEmbeddings();
  const all = process.argv.includes("--all");
  const where = all ? {} : { OR: [{ embeddingModel: null }, { embeddingModel: { not: embeddings.name } }] };
  const total = await prisma.extractedChunk.count({ where });
  console.log(`[reembed] model ${embeddings.name}: ${total} chunk(s) to embed${all ? " (--all)" : ""}`);

  let done = 0;
  let cursor: string | undefined;
  for (;;) {
    const rows = await prisma.extractedChunk.findMany({
      where,
      select: { id: true, content: true },
      orderBy: { id: "asc" },
      take: BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (rows.length === 0) break;
    const vectors = await embeddings.embed(rows.map((r) => r.content), { kind: "document" });
    for (let i = 0; i < rows.length; i++) {
      await prisma.$executeRawUnsafe(
        `UPDATE "extracted_chunks" SET embedding = $1::vector, "embeddingModel" = $2 WHERE id = $3`,
        toVectorLiteral(vectors[i]),
        embeddings.name,
        rows[i].id,
      );
    }
    done += rows.length;
    cursor = rows[rows.length - 1].id;
    console.log(`[reembed] ${done}/${total}`);
    // Without --all the filter shrinks as rows are re-tagged; restart from the top.
    if (!all) cursor = undefined;
  }
  console.log("[reembed] done");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
