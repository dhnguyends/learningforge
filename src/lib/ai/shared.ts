import { ZodError, type ZodTypeAny, type output } from "zod";
import { AIProviderError } from "@/lib/ai/types";

export interface RawCompletion {
  text: string;
  usage: { inputTokens: number; outputTokens: number };
}

/**
 * Models often write LaTeX inside JSON strings with a single backslash, and
 * `\f` / `\b` are valid JSON escapes (form feed / backspace) — so "\frac" and
 * "\beta" silently decode to a control character followed by "rac" / "eta".
 * Neither control character ever belongs in study content, so restore the
 * backslash. (`\t`, `\n`, `\r` are ambiguous with real whitespace and are
 * left alone.)
 */
export function restoreLatexEscapes<T>(value: T): T {
  if (typeof value === "string") {
    return value
      .replace(/\u000c/g, "\\f")
      .replace(/\u0008/g, "\\b")
      // \t, \r, \n are ambiguous with real whitespace (tab-indented code!), so
      // only restore them before known LaTeX command names: "\tilde" decoded
      // as TAB + "ilde", "\rho" as CR + "ho", "\nabla" as LF + "abla".
      .replace(/\t(?=(?:ilde|heta|ext|extbf|extit|extrm|imes|au|frac|op|riangle|o|ag|anh|an)(?![A-Za-z]))/g, "\\t")
      .replace(/\r(?=(?:ho|ight|ightarrow|angle|ceil|floor|m|vert|Vert|Rightarrow)(?![A-Za-z]))/g, "\\r")
      // Newlines are real far more often — only restore known LaTeX commands.
      .replace(/\n(?=(?:abla|eq|eg|ewline|onumber|otin|ot|u|i|exists|parallel|mid|leftarrow|Leftarrow|rightarrow)(?![A-Za-z]))/g, "\\n") as T;
  }
  if (Array.isArray(value)) return value.map((v) => restoreLatexEscapes(v)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, restoreLatexEscapes(v)])) as T;
  }
  return value;
}

/** Extract a JSON object from a model response that may include fences or prose. */
export function extractJson(text: string): unknown {
  return restoreLatexEscapes(parseJsonLoose(text));
}

function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first !== -1 && last > first) {
      try {
        return JSON.parse(trimmed.slice(first, last + 1));
      } catch {
        /* fall through */
      }
    }
    throw new AIProviderError(`Model returned non-JSON output: ${trimmed.slice(0, 200)}`);
  }
}

/**
 * Parse → validate → single repair round. Keeps the structured-output contract
 * honest without retry loops that multiply cost.
 */
export async function parseWithRepair<S extends ZodTypeAny>(
  completion: RawCompletion,
  schema: S,
  repair: (problem: string) => Promise<RawCompletion>,
): Promise<{ data: output<S>; usage: RawCompletion["usage"] }> {
  let parsed: unknown;
  try {
    parsed = extractJson(completion.text);
  } catch (err) {
    if (err instanceof AIProviderError) {
      const fixed = await repair(`The previous output was not valid JSON: ${err.message}`);
      parsed = extractJson(fixed.text);
      completion = fixed;
    } else throw err;
  }

  const result = schema.safeParse(parsed);
  if (result.success) return { data: result.data, usage: completion.usage };

  const issues = new ZodError(result.error.issues)
    .issues.slice(0, 8)
    .map((i) => `${i.path.join(".")}: ${i.message}`)
    .join("; ");

  const fixed = await repair(`The JSON did not match the required schema — ${issues}. Return corrected JSON only.`);
  const reparsed = schema.safeParse(extractJson(fixed.text));
  if (!reparsed.success) {
    throw new AIProviderError(`Structured output failed schema validation twice: ${issues}`);
  }
  return { data: reparsed.data, usage: fixed.usage };
}
