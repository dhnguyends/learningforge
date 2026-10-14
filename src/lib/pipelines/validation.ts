import type { FlashcardDraft, QuizQuestionDraft, ExerciseDraft, GuideSectionContent } from "@/lib/pipelines/schemas";

/**
 * Stage 7 of the generation pipeline: the validation pass.
 * Pure functions, unit-tested. Every generator output passes through here
 * before persistence; problems become visible warnings on the artifact.
 */

// --- Chunk-id trust boundary --------------------------------------------------

/** Never trust ids the model may have invented: intersect with the provided set. */
export function filterValidChunkIds(ids: string[], provided: Set<string>): string[] {
  return ids.filter((id) => provided.has(id));
}

// --- Chunk references from the model ---------------------------------------------

/**
 * Resolve one chunk reference written by the model to a provided chunk id.
 * Context blocks are labelled "[CHUNK 3] (id=cmv8…)", and local models often
 * cite the label ("CHUNK 3", "chunk_3", "3", "id=cmv8…") instead of the bare
 * id. Positional labels map to the n-th provided chunk; anything that is not
 * a provided id or a valid position resolves to null (never trusted).
 */
export function resolveChunkRef(ref: string, chunkIds: readonly string[]): string | null {
  const cleaned = ref.trim().replace(/^\[|\]$/g, "").replace(/^id\s*[=:]\s*/i, "").trim();
  if (chunkIds.includes(cleaned)) return cleaned;
  const positional = cleaned.match(/^(?:chunk[\s_#-]*)?(\d{1,3})$/i);
  if (positional) {
    const n = Number(positional[1]);
    if (n >= 1 && n <= chunkIds.length) return chunkIds[n - 1];
  }
  return null;
}

/** Resolve and de-duplicate a list of model chunk references (order kept). */
export function resolveChunkRefs(refs: readonly string[], chunkIds: readonly string[]): string[] {
  const out: string[] = [];
  for (const ref of refs) {
    const id = resolveChunkRef(ref, chunkIds);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

// --- Inline chunk ids ---------------------------------------------------------

/**
 * Some models (e.g. Gemma 4) cite by writing chunk ids into the prose —
 * "… measured in ohms [cmv8bahit0000730q…]." or, inside formulas,
 * "$$Z = i L \omega \quad \text{cmv8bahjl…}$$" — which the UI would render as
 * raw ids. Remove those citation tokens and return the KNOWN ids among them,
 * so they can be merged into the structured anchor fields.
 *
 * A token counts as a citation when it is a provided chunk id, or looks like
 * one (cuid-shaped: "c" + 20–32 lowercase alphanumerics) — models sometimes
 * garble ids, and a garbled id is never meaningful to a reader; it is
 * dropped from the text but never trusted as an anchor. Ordinary brackets
 * (links, "[1]", intervals) are left untouched.
 */
export function extractInlineChunkIds(content: string, validIds: Iterable<string>): { content: string; ids: string[] } {
  const known = new Set(validIds);
  const isCitation = (token: string) => known.has(token) || CUID_LIKE.test(token);
  const found: string[] = [];
  const keep = (token: string) => {
    if (known.has(token) && !found.includes(token)) found.push(token);
  };

  const cleaned = content
    // [id] / [id, id] / [chunk: id] in prose (not markdown links "[text](url)").
    .replace(/[ \t]*\[([^\[\]\n]{1,400})\](?!\()/g, (match, inner: string) => {
      const tokens = inner.split(/[,;\s]+/).map((t) => t.replace(/^(?:chunk|id)[:=]\s*/i, "").trim()).filter(Boolean);
      if (tokens.length === 0 || !tokens.every(isCitation)) return match;
      tokens.forEach(keep);
      return "";
    })
    // \quad \text{id} / \text{id} inside LaTeX.
    .replace(/(?:\s*\\quad)?\s*\\text\{\s*([A-Za-z0-9_-]{8,64})\s*\}/g, (match, token: string) => {
      if (!isCitation(token)) return match;
      keep(token);
      return "";
    });
  return { content: cleaned.replace(/[ \t]+([.,;:!?])/g, "$1"), ids: found };
}

const CUID_LIKE = /^c[a-z0-9]{20,32}$/;

// --- Guide sections ------------------------------------------------------------

export function validateGuideSection(
  content: GuideSectionContent,
  validChunkIds: string[],
): { warnings: string[]; anchors: string[] } {
  const warnings = [...content.warnings];
  const anchors = filterValidChunkIds(content.anchorChunkIds, new Set(validChunkIds));

  if (content.content.trim().length < 40) warnings.push("Section is unusually short — verify completeness.");
  if (content.claimType === "source_grounded" && anchors.length === 0) {
    warnings.push("Claims to be source-grounded but cites no verifiable source chunk. Inspect before trusting.");
  }
  if (content.confidence < 0.6) warnings.push("Low model confidence — compare against the cited source.");
  if (containsEquations(content.content) && anchors.length === 0) {
    warnings.push("Contains equations without a source anchor — symbols may not match the lecture's notation.");
  }
  return { warnings, anchors };
}

function containsEquations(text: string): boolean {
  return /\$\$|\\frac|\\sum|\\nabla|\\partial|\\dot\{/.test(text);
}

// --- Flashcards ------------------------------------------------------------------

export function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/\{\{[^}]*\}\}/g, " cloze ")
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2),
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Drop near-duplicate cards (Jaccard ≥ 0.8 on fronts), keeping the first. */
export function dedupeFlashcards(cards: FlashcardDraft[]): { kept: FlashcardDraft[]; duplicates: number } {
  const kept: FlashcardDraft[] = [];
  let duplicates = 0;
  for (const card of cards) {
    const cardTokens = tokenize(card.front);
    const dup = kept.some((k) => jaccard(tokenize(k.front), cardTokens) >= 0.8);
    if (dup) duplicates++;
    else kept.push(card);
  }
  return { kept, duplicates };
}

// --- Quiz questions -----------------------------------------------------------------

export function validateQuizQuestion(q: QuizQuestionDraft): string[] {
  const warnings = [...q.warnings];
  const optionIds = new Set((q.options ?? []).map((o) => o.id));

  switch (q.type) {
    case "multiple_choice": {
      if ((q.options?.length ?? 0) < 3) warnings.push("Fewer than 3 options — ambiguous single-select.");
      const texts = new Set((q.options ?? []).map((o) => o.text.trim().toLowerCase()));
      if (texts.size !== (q.options ?? []).length) warnings.push("Duplicate option texts — the question is ambiguous.");
      const correct = q.answer.correctIds ?? [];
      if (correct.length !== 1) warnings.push("Multiple-choice must have exactly one correct answer.");
      if (correct.some((id) => !optionIds.has(id))) warnings.push("Correct answer id does not match any option.");
      break;
    }
    case "multi_select": {
      const correct = q.answer.correctIds ?? [];
      if (correct.length < 2) warnings.push("Multi-select with fewer than 2 correct answers — use single-select instead.");
      if ((q.options?.length ?? 0) - correct.length < 1) warnings.push("Not enough distractors for multi-select.");
      if (correct.some((id) => !optionIds.has(id))) warnings.push("Correct answer id does not match any option.");
      break;
    }
    case "short_answer": {
      if ((q.answer.text?.length ?? 0) === 0) warnings.push("No acceptable answer text defined.");
      break;
    }
    case "numerical": {
      if (!q.answer.numeric) warnings.push("Numerical question missing its numeric answer.");
      else if (q.answer.numeric.tolerance == null && !Number.isInteger(q.answer.numeric.value)) {
        warnings.push("Non-integer numeric answer without tolerance — accept range may be too strict.");
      }
      break;
    }
    case "ordering":
    case "derivation_steps": {
      const order = q.answer.order ?? [];
      if (order.length < 3) warnings.push("Ordering question with fewer than 3 steps is trivially guessable.");
      if (order.some((id) => !optionIds.has(id))) warnings.push("Ordering answer references a non-existent option.");
      if (order.length !== (q.options ?? []).length) warnings.push("Ordering answer does not include every option exactly once — ambiguous.");
      break;
    }
    case "matching": {
      const pairs = q.answer.pairs ?? [];
      if (pairs.length < 3) warnings.push("Matching question with fewer than 3 pairs is trivially guessable.");
      if (pairs.some((p) => !optionIds.has(p.optionId))) warnings.push("Matching pair references a non-existent option.");
      break;
    }
    case "code_tracing": {
      if (!q.options?.length && !q.answer.text?.length && !q.answer.numeric) {
        warnings.push("Code-tracing question defines no checkable answer.");
      }
      break;
    }
  }

  if (q.explanation.length < 20) warnings.push("Explanation too thin to teach from.");
  return warnings;
}

export type QuizNormalization = { question: QuizQuestionDraft; note?: string } | { dropped: string };

/**
 * Make a generated question's answer consistent with its type before it is
 * stored, so every persisted question is answerable and gradable.
 *
 * The quiz schema is a loose union (options optional, every answer field
 * optional), and local models mix shapes: Gemma 4 labelled questions
 * multiple_choice but answered them short-answer style with no options at
 * all — the quiz page then showed stems with nothing to pick, and grading
 * would mark every response wrong. Rules:
 * - choice questions need ≥2 options and correct ids that exist; without
 *   options but with an answer text they become short_answer;
 * - a correct answer given as option TEXT is mapped to its option id;
 * - numerical needs a finite value (else short_answer from text);
 * - ordering/derivation_steps need a permutation of the options; matching
 *   needs pairs over existing options — otherwise the question is dropped;
 * - only the answer fields of the final type are kept.
 * Pure; unit-tested.
 */
export function normalizeQuizQuestion(input: QuizQuestionDraft): QuizNormalization {
  const options = (input.options ?? []).filter((o) => o.id.trim() && o.text.trim());
  const optionIds = new Set(options.map((o) => o.id));
  const texts = (input.answer.text ?? []).map((t) => t.trim()).filter(Boolean);
  const byText = new Map(options.map((o) => [o.text.trim().toLowerCase(), o.id]));
  const correctIds = [
    ...new Set(
      [...(input.answer.correctIds ?? []), ...texts]
        .map((v) => (optionIds.has(v) ? v : byText.get(v.trim().toLowerCase())))
        .filter((v): v is string => Boolean(v)),
    ),
  ];

  const as = (type: QuizQuestionDraft["type"], answer: QuizQuestionDraft["answer"], keepOptions: boolean, note?: string): QuizNormalization => ({
    question: { ...input, type, options: keepOptions ? options : [], answer },
    note,
  });
  const toShortAnswer = (why: string): QuizNormalization =>
    texts.length
      ? as("short_answer", { text: texts }, false, `Converted to short answer: ${why}.`)
      : { dropped: `${input.type} question with ${why} and no answer text` };

  switch (input.type) {
    case "multiple_choice":
    case "multi_select": {
      if (options.length < 2) return toShortAnswer("the generator gave no answer options");
      if (correctIds.length === 0) return { dropped: `${input.type} question whose correct answer matches no option` };
      if (input.type === "multiple_choice" && correctIds.length > 1) return as("multi_select", { correctIds }, true, "Converted to multi-select: more than one correct option.");
      if (input.type === "multi_select" && correctIds.length === 1) return as("multiple_choice", { correctIds }, true);
      return as(input.type, { correctIds }, true);
    }
    case "short_answer":
      if (texts.length) return as("short_answer", { text: texts }, false);
      if (options.length >= 2 && correctIds.length === 1) return as("multiple_choice", { correctIds }, true);
      return { dropped: "short_answer question with no acceptable answer" };
    case "code_tracing":
      if (texts.length) return as("code_tracing", { text: texts }, false);
      return { dropped: "code_tracing question with no expected output" };
    case "numerical": {
      const numeric = input.answer.numeric;
      if (numeric && Number.isFinite(numeric.value)) return as("numerical", { numeric }, false);
      return toShortAnswer("no numeric answer");
    }
    case "ordering":
    case "derivation_steps": {
      const order = (input.answer.order ?? []).filter((id) => optionIds.has(id));
      const isPermutation = order.length === options.length && new Set(order).size === order.length && options.length >= 2;
      return isPermutation ? as(input.type, { order }, true) : { dropped: `${input.type} question whose answer order does not match its options` };
    }
    case "matching": {
      const pairs = (input.answer.pairs ?? []).filter((p) => optionIds.has(p.optionId) && p.value.trim());
      return pairs.length >= 2 ? as("matching", { pairs }, true) : { dropped: "matching question without valid pairs" };
    }
    default:
      return { dropped: `unsupported question type ${String(input.type)}` };
  }
}

// --- Exercises ---------------------------------------------------------------------

export function validateExercise(e: ExerciseDraft): string[] {
  const warnings = [...e.warnings];

  if (e.estimatedMinutes < 5 && e.difficulty !== "easy") {
    warnings.push("Time estimate looks low for this difficulty.");
  }
  if (e.hints.length !== 3) warnings.push("Expected exactly 3 progressive hints.");
  if (!e.grounded && e.chunkIds.length > 0) {
    warnings.push("Marked as transfer exercise but cites sources — verify whether it is actually source-grounded.");
  }
  if (e.grounded && e.chunkIds.length === 0) {
    warnings.push("Marked source-grounded but cites no chunks.");
  }
  const arithmetic = verifyArithmetic(e.solution);
  warnings.push(...arithmetic);
  return warnings;
}

// --- Arithmetic verification ----------------------------------------------------------

/**
 * Finds plain-number statements of the form "a op b ... = c" in generated text
 * and verifies them with a safe evaluator. Used as a cheap sanity net for
 * generated quantitative problems. Returns warnings for mismatches.
 */
export function verifyArithmetic(text: string): string[] {
  const warnings: string[] = [];
  // "12 × 4 = 48", "3.5*2 = 7", "(2+3)*4 = 20" — allow simple chains.
  const pattern = /(\(?-?\d+(?:\.\d+)?(?:\s*[+*×x÷/\-]\s*\(?-?\d+(?:\.\d+)?\)?)+)\s*=\s*(-?\d+(?:\.\d+)?)/g;
  for (const match of text.matchAll(pattern)) {
    const expr = match[1].replace(/[×x]/g, "*").replace(/÷/g, "/");
    const expected = Number.parseFloat(match[2]);
    const actual = safeEvaluate(expr);
    if (actual != null && Math.abs(actual - expected) > Math.max(0.01, Math.abs(expected) * 1e-6)) {
      warnings.push(`Arithmetic check failed: "${match[0]}" evaluates to ${round(actual)}, not ${expected}.`);
    }
  }
  return warnings;
}

/** Shunting-yard evaluator for + - * / ^ and parentheses only. */
export function safeEvaluate(expression: string): number | null {
  const tokens = expression.match(/\d+(?:\.\d+)?|[+\-*/()^]/g);
  if (!tokens) return null;
  const precedence: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2, "^": 3 };
  const output: (number | string)[] = [];
  const ops: string[] = [];

  for (const token of tokens) {
    if (/^\d/.test(token)) output.push(Number.parseFloat(token));
    else if (token === "(") ops.push(token);
    else if (token === ")") {
      while (ops.length && ops[ops.length - 1] !== "(") output.push(ops.pop()!);
      if (!ops.length) return null;
      ops.pop();
    } else {
      while (
        ops.length &&
        ops[ops.length - 1] !== "(" &&
        precedence[ops[ops.length - 1]] >= precedence[token]
      ) {
        output.push(ops.pop()!);
      }
      ops.push(token);
    }
  }
  while (ops.length) {
    const op = ops.pop()!;
    if (op === "(") return null;
    output.push(op);
  }

  const stack: number[] = [];
  for (const token of output) {
    if (typeof token === "number") stack.push(token);
    else {
      const b = stack.pop();
      const a = stack.pop();
      if (a == null || b == null) return null;
      stack.push(token === "+" ? a + b : token === "-" ? a - b : token === "*" ? a * b : token === "/" ? a / b : a ** b);
    }
  }
  return stack.length === 1 ? stack[0] : null;
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
