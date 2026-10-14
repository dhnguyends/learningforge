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
