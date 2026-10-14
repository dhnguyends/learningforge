import { prisma } from "@/lib/db";
import { makeExcerpt } from "@/lib/citations";
import type { RetrievedChunk } from "@/lib/retrieval";

/** Create durable CitationAnchor rows for the chunks an artifact cites. */
export async function createAnchorsForChunks(chunks: RetrievedChunk[]): Promise<string[]> {
  const ids: string[] = [];
  for (const chunk of chunks) {
    const anchor = await prisma.citationAnchor.create({
      data: {
        sourceId: chunk.sourceId,
        chunkId: chunk.id,
        sourceType: await sourceTypeFor(chunk),
        ...(chunk.startMs != null ? { startMs: chunk.startMs, endMs: chunk.endMs } : {}),
        ...(chunk.page != null ? { page: chunk.page } : {}),
        excerpt: makeExcerpt(chunk.content),
      },
    });
    ids.push(anchor.id);
  }
  return ids;
}

async function sourceTypeFor(chunk: RetrievedChunk) {
  const source = await prisma.source.findUnique({ where: { id: chunk.sourceId }, select: { type: true } });
  if (!source) throw new Error(`Source ${chunk.sourceId} vanished during generation`);
  return source.type;
}

/** Compact per-chunk id ↔ chunk lookup used to validate model-referenced ids. */
export function chunkMap(chunks: RetrievedChunk[]): Map<string, RetrievedChunk> {
  return new Map(chunks.map((c) => [c.id, c]));
}
