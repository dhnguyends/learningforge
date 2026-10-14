import { createHash } from "node:crypto";
import OpenAI from "openai";
import { getEnv } from "@/lib/env";

const DIMENSIONS = 1536;

export interface EmbeddingVector {
  vector: number[];
  model: string;
}

export interface EmbeddingProvider {
  readonly name: string;
  embed(texts: string[]): Promise<number[][]>;
}

/** Deterministic hashed bag-of-words vectors: lexical similarity, no network. */
class MockEmbeddings implements EmbeddingProvider {
  readonly name = "mock-hash";

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => mockVector(text));
  }
}

export function mockVector(text: string): number[] {
  const vec = new Array<number>(DIMENSIONS).fill(0);
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
  const counts = new Map<string, number>();
  for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
  for (const [token, count] of counts) {
    const hash = createHash("md5").update(token).digest();
    const idx = ((hash[0] << 8) | hash[1]) % DIMENSIONS;
    const sign = hash[2] % 2 === 0 ? 1 : -1;
    vec[idx] += sign * (1 + Math.log(count));
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

class OpenAIEmbeddings implements EmbeddingProvider {
  readonly name = "openai";
  private client: OpenAI;
  private model: string;

  constructor() {
    const env = getEnv();
    this.model = env.EMBEDDINGS_MODEL;
    this.client = new OpenAI({
      apiKey: env.OPENAI_API_KEY,
      ...(env.OPENAI_BASE_URL ? { baseURL: env.OPENAI_BASE_URL } : {}),
    });
  }

  async embed(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    // Batch to stay under per-request limits.
    for (let i = 0; i < texts.length; i += 64) {
      const batch = texts.slice(i, i + 64).map((t) => t.slice(0, 8000));
      const res = await this.client.embeddings.create({
        model: this.model,
        input: batch,
        dimensions: DIMENSIONS,
      });
      out.push(...res.data.map((d) => d.embedding));
    }
    return out;
  }
}

let cached: EmbeddingProvider | null = null;

export function getEmbeddings(): EmbeddingProvider {
  if (cached) return cached;
  cached = getEnv().EMBEDDINGS_PROVIDER === "openai" ? new OpenAIEmbeddings() : new MockEmbeddings();
  return cached;
}

/** pgvector literal for raw SQL, e.g. ... = $1::vector. */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.map((v) => v.toFixed(7)).join(",")}]`;
}
