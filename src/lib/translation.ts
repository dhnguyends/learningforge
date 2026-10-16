import { getEnv, mockProvidersAllowed } from "@/lib/env";
import { cpuTimeoutFactor } from "@/lib/gpu";
import type { SourceLanguage } from "@/lib/language";
import { getActiveTranslator } from "@/lib/speech/settings";

/**
 * Machine translation of source text (passages, transcript segments), e.g. a
 * French lecture to English. Order and count are preserved: translate(texts)[i]
 * is the translation of texts[i].
 */
export interface Translator {
  readonly name: string;
  translate(texts: string[], from: SourceLanguage, to: SourceLanguage): Promise<string[]>;
}

const LANGUAGE_NAMES: Record<SourceLanguage, string> = { fr: "French", en: "English" };

/** Offline stand-in for tests and demos: marks the text instead of translating it. */
class MockTranslator implements Translator {
  readonly name = "mock";
  async translate(texts: string[], _from: SourceLanguage, to: SourceLanguage): Promise<string[]> {
    return texts.map((t) => `[${to.toUpperCase()}] ${t}`);
  }
}

/**
 * Gemma 4 (or whichever LOCAL_AI_MODEL) through Ollama, a few items per call
 * with schema-constrained JSON so the count and order are kept. A batch that
 * comes back with the wrong number of items is retried item by item.
 */
export class LocalTranslator implements Translator {
  readonly name: string;
  private baseUrl: string;
  private model: string;
  private timeoutMs: number;
  /** Items per call: transcript segments are short, passages are ~330 tokens. */
  batchChars = 2_400;

  constructor() {
    const env = getEnv();
    this.model = env.LOCAL_AI_MODEL;
    this.name = `ollama:${this.model}`;
    this.baseUrl = env.LOCAL_AI_BASE_URL.replace(/\/$/, "");
    this.timeoutMs = env.LOCAL_AI_TIMEOUT_MS;
  }

  async translate(texts: string[], from: SourceLanguage, to: SourceLanguage): Promise<string[]> {
    const out: string[] = new Array(texts.length);
    let batch: number[] = [];
    let size = 0;
    const flush = async () => {
      if (!batch.length) return;
      const got = await this.translateBatch(batch.map((i) => texts[i]), from, to).catch(() => null);
      if (got && got.length === batch.length) batch.forEach((i, j) => (out[i] = got[j]));
      else for (const i of batch) out[i] = (await this.translateBatch([texts[i]], from, to))[0] ?? texts[i];
      batch = [];
      size = 0;
    };
    for (let i = 0; i < texts.length; i++) {
      if (size + texts[i].length > this.batchChars && batch.length) await flush();
      batch.push(i);
      size += texts[i].length;
    }
    await flush();
    return out;
  }

  private async translateBatch(items: string[], from: SourceLanguage, to: SourceLanguage): Promise<string[]> {
    const timeout = this.timeoutMs * (await cpuTimeoutFactor());
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(timeout),
      body: JSON.stringify({
        model: this.model,
        stream: false,
        think: false,
        options: { temperature: 0.2, num_predict: 6_000 },
        format: {
          type: "object",
          properties: { translations: { type: "array", items: { type: "string" }, minItems: items.length, maxItems: items.length } },
          required: ["translations"],
        },
        messages: [
          {
            role: "system",
            content:
              `You are a professional translator. Translate each item from ${LANGUAGE_NAMES[from]} to ${LANGUAGE_NAMES[to]}. ` +
              "Keep the meaning, numbers, formulas, LaTeX, tickers, code and proper nouns exactly. Do not add or drop content, do not summarise. " +
              `Return JSON {"translations": [...]} with exactly ${items.length} strings, in the same order.`,
          },
          { role: "user", content: JSON.stringify(items) },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Translation (local ${this.model}) failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as { message?: { content?: string } };
    const parsed = JSON.parse(json.message?.content ?? "{}") as { translations?: unknown };
    if (!Array.isArray(parsed.translations)) throw new Error("Translation returned no list");
    return parsed.translations.map((t) => String(t ?? "").trim());
  }
}

/** Azure AI Translator (Text Translation v3). Up to 100 items / 50,000 characters per request. */
export class AzureTranslator implements Translator {
  readonly name = "azure-translator";

  async translate(texts: string[], from: SourceLanguage, to: SourceLanguage): Promise<string[]> {
    const env = getEnv();
    const key = env.AZURE_TRANSLATOR_KEY?.trim();
    if (!key) throw new Error("Azure Translator is selected but AZURE_TRANSLATOR_KEY is not set");
    const out: string[] = [];
    let batch: string[] = [];
    let chars = 0;
    const flush = async () => {
      if (!batch.length) return;
      const url = `${env.AZURE_TRANSLATOR_ENDPOINT.replace(/\/$/, "")}/translate?api-version=3.0&from=${from}&to=${to}&textType=plain`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Ocp-Apim-Subscription-Key": key,
          ...(env.AZURE_TRANSLATOR_REGION ? { "Ocp-Apim-Subscription-Region": env.AZURE_TRANSLATOR_REGION } : {}),
        },
        body: JSON.stringify(batch.map((Text) => ({ Text }))),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) {
        const body = await res.text();
        const message = (() => {
          try {
            return (JSON.parse(body) as { error?: { message?: string } }).error?.message ?? body;
          } catch {
            return body;
          }
        })();
        throw new Error(`Azure Translator error ${res.status}: ${message.slice(0, 200)}`);
      }
      const json = (await res.json()) as { translations?: { text: string }[] }[];
      out.push(...json.map((r) => r.translations?.[0]?.text ?? ""));
      batch = [];
      chars = 0;
    };
    for (const t of texts) {
      if ((batch.length >= 100 || chars + t.length > 45_000) && batch.length) await flush();
      batch.push(t);
      chars += t.length;
    }
    await flush();
    return out;
  }
}

/** The translator chosen at /admin (mock in tests and offline demos). */
export async function getTranslator(): Promise<Translator> {
  if (getEnv().AI_PROVIDER === "mock" && mockProvidersAllowed()) return new MockTranslator();
  const { provider } = await getActiveTranslator();
  return provider === "azure" ? new AzureTranslator() : new LocalTranslator();
}
