import { apiHandler, ok, parseJsonBody, requireAdmin, badRequest } from "@/lib/api";
import { AzureTranslator, LocalTranslator } from "@/lib/translation";
import { translatorChoiceProblem, translatorChoiceSchema } from "@/lib/speech/settings";

/**
 * "Test": translates one fixed French sentence with the candidate model so an
 * administrator sees the quality and speed before switching. No user content.
 */
const SAMPLE = "La dérivée d'une fonction mesure la vitesse à laquelle sa valeur change lorsque la variable augmente.";

export const POST = apiHandler(async (req) => {
  await requireAdmin();
  const choice = await parseJsonBody(req, translatorChoiceSchema);
  const { problem, model } = await translatorChoiceProblem(choice);
  if (problem) throw badRequest(problem);
  const translator = choice.provider === "azure" ? new AzureTranslator() : new LocalTranslator(model ?? undefined);
  const started = Date.now();
  try {
    const [text] = await translator.translate([SAMPLE], "fr", "en");
    return ok({ ok: true, translator: translator.name, input: SAMPLE, output: text, latencyMs: Date.now() - started });
  } catch (err) {
    return ok({
      ok: false,
      translator: translator.name,
      input: SAMPLE,
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});
