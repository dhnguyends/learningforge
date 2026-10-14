import { describe, it, expect } from "vitest";
import {
  safeEvaluate,
  verifyArithmetic,
  tokenize,
  jaccard,
  dedupeFlashcards,
  filterValidChunkIds,
  validateGuideSection,
  validateQuizQuestion,
  validateExercise,
} from "@/lib/pipelines/validation";
import type { FlashcardDraft, QuizQuestionDraft, ExerciseDraft, GuideSectionContent } from "@/lib/pipelines/schemas";

describe("safeEvaluate", () => {
  it("evaluates precedence and parentheses correctly", () => {
    expect(safeEvaluate("2 + 3 * 4")).toBe(14);
    expect(safeEvaluate("(2 + 3) * 4")).toBe(20);
    expect(safeEvaluate("2 * 3 ^ 2")).toBe(18);
    expect(safeEvaluate("10 / 4")).toBe(2.5);
    expect(safeEvaluate("1.5 * 2")).toBe(3);
  });

  it("returns null on malformed input instead of throwing", () => {
    expect(safeEvaluate("not math")).toBeNull();
    expect(safeEvaluate("(2 + 3")).toBeNull();
    expect(safeEvaluate("2 + 3)")).toBeNull();
    expect(safeEvaluate("")).toBeNull();
  });
});

describe("verifyArithmetic", () => {
  it("accepts correct statements", () => {
    expect(verifyArithmetic("We compute 12 × 4 = 48 and move on.")).toEqual([]);
    expect(verifyArithmetic("(2+3)*4 = 20")).toEqual([]);
    expect(verifyArithmetic("3.5 * 2 = 7")).toEqual([]);
  });

  it("flags incorrect statements with a warning naming both values", () => {
    const warnings = verifyArithmetic("So 12 × 4 = 49.");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("48");
    expect(warnings[0]).toContain("49");
  });

  it("ignores prose that merely resembles equations", () => {
    expect(verifyArithmetic("The loss in step 2 = the prediction minus the target.")).toEqual([]);
  });
});

describe("tokenize / jaccard", () => {
  it("neutralizes cloze markers and filters short tokens", () => {
    const tokens = tokenize("The {{gradient}} of backprop flows backward, see?");
    // Deleted cloze content collapses to the neutral token "cloze".
    expect(tokens.has("cloze")).toBe(true);
    expect(tokens.has("gradient")).toBe(false); // inside the deletion
    expect(tokens.has("of")).toBe(false); // ≤2 chars filtered
    expect(tokens.has("backprop")).toBe(true);
    expect(tokens.has("backward")).toBe(true);
  });

  it("scores identity 1 and disjointness 0", () => {
    const a = tokenize("gradient descent optimizer");
    const b = tokenize("gradient descent optimizer");
    const c = tokenize("convolutional neural network");
    expect(jaccard(a, b)).toBe(1);
    expect(jaccard(a, c)).toBe(0);
    expect(jaccard(a, new Set())).toBe(0);
  });
});

describe("dedupeFlashcards", () => {
  const card = (front: string): FlashcardDraft => ({
    type: "basic",
    front,
    back: "answer",
    tags: [],
    chunkId: "chunk1",
    supportingChunkIds: [],
  });

  it("drops near-duplicate fronts and keeps the first", () => {
    const { kept, duplicates } = dedupeFlashcards([
      card("Why does reverse-mode AD suit deep learning?"),
      card("Why does reverse mode AD suit deep learning"), // near-identical
      card("Write the momentum update equations."),
    ]);
    expect(kept).toHaveLength(2);
    expect(duplicates).toBe(1);
    expect(kept[0].front).toContain("reverse-mode");
  });

  it("keeps cards that are clearly distinct", () => {
    const { kept, duplicates } = dedupeFlashcards([
      card("Define the computational graph"),
      card("Write Adam's bias-corrected step"),
      card("What does activation checkpointing trade?"),
    ]);
    expect(kept).toHaveLength(3);
    expect(duplicates).toBe(0);
  });
});

describe("filterValidChunkIds", () => {
  it("intersects model-provided ids with the real chunk set", () => {
    const provided = new Set(["c1", "c2", "c3"]);
    expect(filterValidChunkIds(["c1", "invented", "c3"], provided)).toEqual(["c1", "c3"]);
    expect(filterValidChunkIds([], provided)).toEqual([]);
  });
});

describe("validateGuideSection", () => {
  const base: GuideSectionContent = {
    content: "A long enough section body that passes the minimum length check with room to spare.",
    claimType: "source_grounded",
    confidence: 0.9,
    warnings: [],
    anchorChunkIds: ["c1"],
  };

  it("passes a well-formed grounded section", () => {
    const { warnings, anchors } = validateGuideSection(base, ["c1", "c2"]);
    expect(warnings).toEqual([]);
    expect(anchors).toEqual(["c1"]);
  });

  it("warns when a grounded section cites no valid chunk", () => {
    const { warnings } = validateGuideSection({ ...base, anchorChunkIds: ["made-up"] }, ["c1"]);
    expect(warnings.join(" ")).toContain("source-grounded");
  });

  it("warns on low confidence and very short content", () => {
    const { warnings } = validateGuideSection({ ...base, confidence: 0.4, content: "Too short." }, ["c1"]);
    expect(warnings.some((w) => w.includes("confidence"))).toBe(true);
    expect(warnings.some((w) => w.includes("short"))).toBe(true);
  });

  it("warns when equations appear without any anchor", () => {
    const { warnings } = validateGuideSection(
      { ...base, content: "The update is $$\\frac{\\partial L}{\\partial x} = v$$ per step, which is long enough." , anchorChunkIds: [] },
      ["c1"],
    );
    expect(warnings.some((w) => w.includes("equations"))).toBe(true);
  });
});

describe("validateQuizQuestion", () => {
  const mc: QuizQuestionDraft = {
    type: "multiple_choice",
    stem: "Backpropagation computes gradients by which mechanism?",
    options: [
      { id: "a", text: "vector-Jacobian products" },
      { id: "b", text: "symbolic differentiation" },
      { id: "c", text: "finite differences" },
    ],
    answer: { correctIds: ["a"] },
    explanation: "The framework chains vector-Jacobian products over the graph.",
    learningObjective: "Explain what backprop computes",
    difficulty: "medium",
    chunkId: "c1",
    warnings: [],
  };

  it("passes a well-formed question", () => {
    expect(validateQuizQuestion(mc)).toEqual([]);
  });

  it("flags multiple correct ids in single-select", () => {
    const warnings = validateQuizQuestion({ ...mc, answer: { correctIds: ["a", "b"] } });
    expect(warnings.some((w) => w.includes("exactly one"))).toBe(true);
  });

  it("flags correct ids that match no option", () => {
    const warnings = validateQuizQuestion({ ...mc, answer: { correctIds: ["zz"] } });
    expect(warnings.some((w) => w.includes("does not match"))).toBe(true);
  });

  it("flags duplicate option texts", () => {
    const warnings = validateQuizQuestion({
      ...mc,
      options: [
        { id: "a", text: "vector-Jacobian products" },
        { id: "b", text: "Vector-Jacobian products" },
        { id: "c", text: "finite differences" },
      ],
    });
    expect(warnings.some((w) => w.includes("Duplicate option"))).toBe(true);
  });

  it("flags multi-select with too few correct answers or distractors", () => {
    const warnings = validateQuizQuestion({
      ...mc,
      type: "multi_select",
      answer: { correctIds: ["a"] },
    });
    expect(warnings.some((w) => w.includes("fewer than 2"))).toBe(true);
  });

  it("flags ordering questions that omit options or are trivially short", () => {
    const warnings = validateQuizQuestion({
      ...mc,
      type: "ordering",
      answer: { order: ["a", "b"] },
    });
    expect(warnings.some((w) => w.includes("fewer than 3"))).toBe(true);
    expect(warnings.some((w) => w.includes("every option exactly once"))).toBe(true);
  });

  it("flags matching questions with missing pairs", () => {
    const warnings = validateQuizQuestion({
      ...mc,
      type: "matching",
      answer: { pairs: [{ optionId: "a", value: "x" }, { optionId: "b", value: "y" }] },
    });
    expect(warnings.some((w) => w.includes("fewer than 3"))).toBe(true);
  });

  it("flags numerical answers with no tolerance for non-integer values", () => {
    const warnings = validateQuizQuestion({ ...mc, type: "numerical", answer: { numeric: { value: 0.1858 } } });
    expect(warnings.some((w) => w.includes("tolerance"))).toBe(true);
  });

  it("flags thin explanations regardless of type", () => {
    const warnings = validateQuizQuestion({ ...mc, explanation: "Because." });
    expect(warnings.some((w) => w.includes("Explanation"))).toBe(true);
  });
});

describe("validateExercise", () => {
  const base: ExerciseDraft = {
    type: "derivation",
    title: "Backprop through softmax",
    prompt: "Derive the gradient of cross-entropy with respect to the logits.",
    prerequisites: [],
    assumptions: [],
    requiredKnowledge: [],
    estimatedMinutes: 25,
    difficulty: "hard",
    grounded: true,
    hints: ["h1", "h2", "h3"],
    solution: "Start from the chain rule and simplify to p - e_y.",
    chunkIds: ["c1"],
    warnings: [],
  };

  it("passes a well-formed grounded exercise", () => {
    expect(validateExercise(base)).toEqual([]);
  });

  it("requires exactly three hints", () => {
    const warnings = validateExercise({ ...base, hints: ["only one"] });
    expect(warnings.some((w) => w.includes("3 progressive hints"))).toBe(true);
  });

  it("flags grounded exercises with no chunks and transfer exercises with chunks", () => {
    const noChunks = validateExercise({ ...base, chunkIds: [] });
    expect(noChunks.some((w) => w.includes("cites no chunks"))).toBe(true);
    const contradictory = validateExercise({ ...base, grounded: false });
    expect(contradictory.some((w) => w.includes("verify whether"))).toBe(true);
  });

  it("propagates arithmetic warnings from the solution text", () => {
    const warnings = validateExercise({ ...base, solution: "First compute 6 * 7 = 42, then 6 * 7 = 41 which fails." });
    expect(warnings.some((w) => w.includes("Arithmetic check failed"))).toBe(true);
  });
});
