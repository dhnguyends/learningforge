import { describe, it, expect } from "vitest";
import { normalizeQuizQuestion, type QuizNormalization } from "@/lib/pipelines/validation";
import type { QuizQuestionDraft } from "@/lib/pipelines/schemas";

const base: QuizQuestionDraft = {
  type: "multiple_choice",
  stem: "Which relationship holds for a resistor?",
  options: [],
  answer: {},
  explanation: "Ohm's law relates voltage, current and resistance.",
  learningObjective: "Students will be able to apply Ohm's law",
  difficulty: "medium",
  chunkId: "c1",
  warnings: [],
};
const q = (over: Partial<QuizQuestionDraft>): QuizQuestionDraft => ({ ...base, ...over });
const opts = (...texts: string[]) => texts.map((text, i) => ({ id: String.fromCharCode(97 + i), text }));
const kept = (n: QuizNormalization) => {
  if ("dropped" in n) throw new Error(`unexpectedly dropped: ${n.dropped}`);
  return n;
};

describe("normalizeQuizQuestion", () => {
  it("turns Gemma's option-less multiple choice into an answerable short answer (production regression)", () => {
    const n = kept(normalizeQuizQuestion(q({ answer: { text: ["$V = IR$"], numeric: { value: 1, tolerance: 0.01 } } })));
    expect(n.question.type).toBe("short_answer");
    expect(n.question.answer).toEqual({ text: ["$V = IR$"] }); // stray numeric removed
    expect(n.question.options).toEqual([]);
    expect(n.note).toMatch(/no answer options/);
  });

  it("keeps a well-formed multiple choice", () => {
    const n = kept(normalizeQuizQuestion(q({ options: opts("V=IR", "V=I/R", "V=R/I"), answer: { correctIds: ["a"] } })));
    expect(n.question.type).toBe("multiple_choice");
    expect(n.question.answer).toEqual({ correctIds: ["a"] });
    expect(n.note).toBeUndefined();
  });

  it("maps a correct answer given as option text to its id", () => {
    const n = kept(normalizeQuizQuestion(q({ options: opts("V=IR", "V=I/R", "V=R/I"), answer: { text: ["v=ir"] } })));
    expect(n.question.answer).toEqual({ correctIds: ["a"] });
  });

  it("re-types single/multi select by the number of correct options", () => {
    expect(kept(normalizeQuizQuestion(q({ options: opts("x", "y", "z"), answer: { correctIds: ["a", "b"] } }))).question.type).toBe("multi_select");
    expect(kept(normalizeQuizQuestion(q({ type: "multi_select", options: opts("x", "y", "z"), answer: { correctIds: ["c"] } }))).question.type).toBe("multiple_choice");
  });

  it("drops a choice question whose correct answer matches no option", () => {
    expect(normalizeQuizQuestion(q({ options: opts("x", "y", "z"), answer: { correctIds: ["nope"] } }))).toHaveProperty("dropped");
  });

  it("falls back from numerical without a value to short answer, or drops it", () => {
    expect(kept(normalizeQuizQuestion(q({ type: "numerical", answer: { text: ["42 V"] } }))).question.type).toBe("short_answer");
    expect(normalizeQuizQuestion(q({ type: "numerical", answer: {} }))).toHaveProperty("dropped");
    expect(kept(normalizeQuizQuestion(q({ type: "numerical", answer: { numeric: { value: 5, unit: "V" } } }))).question.answer).toEqual({ numeric: { value: 5, unit: "V" } });
  });

  it("requires ordering answers to be a permutation of the options", () => {
    const options = opts("first", "second", "third");
    expect(kept(normalizeQuizQuestion(q({ type: "ordering", options, answer: { order: ["b", "a", "c"] } }))).question.answer).toEqual({ order: ["b", "a", "c"] });
    expect(normalizeQuizQuestion(q({ type: "ordering", options, answer: { order: ["a", "b"] } }))).toHaveProperty("dropped");
  });

  it("keeps only valid matching pairs and needs at least two", () => {
    const options = opts("R", "C", "L");
    const n = kept(normalizeQuizQuestion(q({ type: "matching", options, answer: { pairs: [{ optionId: "a", value: "ohm" }, { optionId: "b", value: "farad" }, { optionId: "zz", value: "x" }] } })));
    expect(n.question.answer.pairs).toHaveLength(2);
    expect(normalizeQuizQuestion(q({ type: "matching", options, answer: { pairs: [{ optionId: "a", value: "ohm" }] } }))).toHaveProperty("dropped");
  });
});
