import { getEnv } from "@/lib/env";
import { getActiveAi } from "@/lib/ai/settings";
import { clearOllamaGpu, type GpuClearReport } from "@/lib/ai/ollama";
import { getActiveTranslator } from "@/lib/speech/settings";

/**
 * After the AI model or the translator changed: unload the Ollama language
 * models that neither uses any more, at once, instead of after Ollama's
 * 5-minute keep-alive. With both in the cloud, every language model goes;
 * with a local translator, its model stays. The embeddings model always stays
 * (search needs it). A local AI model is handled by switchLocalModel instead.
 * Returns what was freed, or null when there was nothing to do or Ollama
 * could not be asked.
 */
export async function releaseUnusedLocalModels(): Promise<GpuClearReport | null> {
  if (getEnv().AI_PROVIDER === "mock") return null;
  const [ai, translator] = await Promise.all([getActiveAi(), getActiveTranslator()]);
  if (ai.provider === "local") return null;
  const keep = translator.provider === "local" ? (translator.model ?? undefined) : undefined;
  try {
    return await clearOllamaGpu({ keep, keepEmbeddings: true });
  } catch {
    return null;
  }
}
