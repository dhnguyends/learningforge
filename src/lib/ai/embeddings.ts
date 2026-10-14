import { createHash } from "node:crypto";
import OpenAI from "openai";
import { getEnv } from "@/lib/env";

const DIMENSIONS = 1536;

export interface EmbeddingVector {
  vector: number[];
  model: string;
}

export type EmbedKind = "query" | "document";

export interface EmbeddingProvider {
  /** Identifies the vector space; stored on every chunk (ExtractedChunk.embeddingModel). */
  readonly name: string;
  /** Cosine-similarity floor below which a chunk is "not relevant" for this model. */
  readonly defaultMinScore: number;
  /** `kind` lets asymmetric models embed questions and passages differently. */
  embed(texts: string[], opts?: { kind?: EmbedKind }): Promise<number[][]>;
}

/** Deterministic hashed bag-of-words vectors: lexical similarity, no network. */
class MockEmbeddings implements EmbeddingProvider {
  readonly name = "mock-hash";
  readonly defaultMinScore = 0.05;

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
  readonly name: string;
  readonly defaultMinScore = 0.2;
  private client: OpenAI;
  private model: string;

  constructor() {
    const env = getEnv();
    this.model = env.EMBEDDINGS_MODEL;
    this.name = `openai:${this.model}`;
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

/**
 * Local Ollama embeddings (default: EmbeddingGemma — multilingual, 768-d,
 * unit-normalised). Vectors are zero-padded to the 1536-d column: padding
 * changes neither dot products nor norms, so cosine similarity is exact and
 * no schema migration is needed. EmbeddingGemma is asymmetric — questions and
 * passages get its recommended task prefixes.
 */
class OllamaEmbeddings implements EmbeddingProvider {
  readonly name: string;
  // Calibrated on EmbeddingGemma (scripts/calibrate-retrieval.ts, two study
  // sets): best on-topic hits score 0.40-0.61 (French questions over English
  // sources 0.46-0.49), off-topic questions at most 0.19. Override with RETRIEVAL_MIN_SCORE.
  readonly defaultMinScore = 0.3;
  private model: string;
  private baseUrl: string;

  constructor() {
    const env = getEnv();
    this.model = env.OLLAMA_EMBEDDINGS_MODEL;
    this.name = `ollama:${this.model}`;
    this.baseUrl = env.LOCAL_AI_BASE_URL.replace(/\/$/, "");
  }

  async embed(texts: string[], opts: { kind?: EmbedKind } = {}): Promise<number[][]> {
    const prefix = opts.kind === "query" ? "task: search result | query: " : "title: none | text: ";
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 32) {
      const input = texts.slice(i, i + 32).map((t) => prefix + t.slice(0, 6000));
      let res: Response;
      try {
        res = await fetch(`${this.baseUrl}/api/embed`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: this.model, input }),
          signal: AbortSignal.timeout(120_000),
        });
      } catch (err) {
        throw new Error(`Embeddings model ${this.model} unreachable at ${this.baseUrl}: ${err instanceof Error ? err.message : err}`);
      }
      if (!res.ok) throw new Error(`Embeddings error ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const json = (await res.json()) as { embeddings: number[][] };
      if (json.embeddings?.length !== input.length) throw new Error("Embeddings response size mismatch");
      for (const v of json.embeddings) {
        if (v.length > DIMENSIONS) throw new Error(`${this.model} returns ${v.length}-d vectors; the index holds ${DIMENSIONS}`);
        out.push(v.length === DIMENSIONS ? v : [...v, ...new Array<number>(DIMENSIONS - v.length).fill(0)]);
      }
    }
    return out;
  }
}

let cached: EmbeddingProvider | null = null;

export function getEmbeddings(): EmbeddingProvider {
  if (cached) return cached;
  const provider = getEnv().EMBEDDINGS_PROVIDER;
  cached = provider === "openai" ? new OpenAIEmbeddings() : provider === "ollama" ? new OllamaEmbeddings() : new MockEmbeddings();
  return cached;
}

/** Retrieval floor: RETRIEVAL_MIN_SCORE if set, else the provider's calibrated default. */
export function retrievalMinScore(): number {
  return getEnv().RETRIEVAL_MIN_SCORE ?? getEmbeddings().defaultMinScore;
}

/** pgvector literal for raw SQL, e.g. ... = $1::vector. */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.map((v) => v.toFixed(7)).join(",")}]`;
}
