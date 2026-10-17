import { z } from "zod";
import { apiHandler, ok, parseJsonBody, requireAdmin, badRequest } from "@/lib/api";
import { getEnv } from "@/lib/env";
import { generatorFor } from "@/lib/ai";
import { aiChoiceSchema, geminiConfigured, localModelProblem, zaiConfigured, zaiModel } from "@/lib/ai/settings";

/**
 * "Test connection": one tiny structured call to the candidate model, so an
 * administrator sees it works (and how fast) before switching every job to it.
 * The prompt contains no user content. A local model is loaded alone on the
 * GPU (the others are unloaded first), as it would be for a real job.
 */

const pingSchema = z.object({ status: z.literal("ok"), echo: z.string() });

export const POST = apiHandler(async (req) => {
  await requireAdmin();
  const choice = await parseJsonBody(req, aiChoiceSchema);
  const env = getEnv();
  if (choice.provider === "gemini" && !geminiConfigured(env)) throw badRequest("GEMINI_API_KEY is not set");
  if (choice.provider === "zai" && !zaiConfigured(env)) throw badRequest("ZAI_API_KEY is not set");
  const model =
    choice.provider === "gemini" ? choice.model : choice.provider === "zai" ? zaiModel(env) : (choice.model ?? env.LOCAL_AI_MODEL);
  if (choice.provider === "local" && env.AI_PROVIDER !== "mock") {
    const problem = await localModelProblem(model, env);
    if (problem) throw badRequest(problem);
  }
  const started = Date.now();
  try {
    const result = await generatorFor({ provider: choice.provider, model }).generate({
      system: "You are a connectivity check.",
      user: 'Reply with status "ok" and echo the word "LearningForge".',
      schema: pingSchema,
      maxTokens: 256,
    });
    return ok({ ok: true, provider: result.provider, model: result.model, latencyMs: Date.now() - started });
  } catch (err) {
    return ok({ ok: false, provider: choice.provider, model, latencyMs: Date.now() - started, error: err instanceof Error ? err.message : String(err) });
  }
});
