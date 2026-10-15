import { apiHandler, ok, requireSession } from "@/lib/api";
import { aiLabel, getActiveAi } from "@/lib/ai/settings";

/** The generation model in use, for the top bar (any signed-in user). */
export const GET = apiHandler(async () => {
  await requireSession();
  const ai = await getActiveAi();
  return ok({ provider: ai.provider, model: ai.model, label: aiLabel(ai), cloud: ai.provider !== "local" && ai.provider !== "mock" });
});
