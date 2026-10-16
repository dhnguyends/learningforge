import { describe, it, expect } from "vitest";
import { accuracy, adaptExercise, modeFor } from "@/lib/polylingue/adapt";
import { exerciseForPlayer, type Exercise } from "@/lib/polylingue/content";
import { checkAnswer } from "@/lib/polylingue/check";
import { buildWeakSession, checkWeak, pickWeakCards, type WeakCard } from "@/lib/polylingue/weak";
import { initialPlacement, nextQuestion, normalizeBank, recordAnswer, suggestedLevel, type PlacementState } from "@/lib/polylingue/placement";
import { CEFR_LEVELS, type Cefr } from "@/lib/polylingue/levels";
import type { Verdict } from "@/lib/polylingue/check";

const ex = (over: Partial<Exercise>): Exercise => ({
  type: "choice",
  prompt: "What does hola mean?",
  text: "",
  answer: "hello",
  accepted: [],
  options: ["hello", "bye", "thanks", "please"],
  pairs: [],
  explanation: "",
  audio: "hola",
  ...over,
});
const many = (v: Verdict, n: number) => Array.from({ length: n }, () => v);

describe("adaptive mode (within the chosen level)", () => {
  it("needs enough answers, then follows recent accuracy", () => {
    expect(modeFor(many("correct", 5))).toBe("normal");
    expect(modeFor(many("correct", 20))).toBe("challenge");
    expect(modeFor([...many("wrong", 10), ...many("correct", 5)])).toBe("support");
    expect(modeFor([...many("correct", 14), ...many("almost", 6)])).toBe("normal");
    expect(accuracy(["correct", "almost", "wrong", "wrong"])).toBe(0.375);
  });

  it("challenge: choices become typed answers on the same content, and typed answers are still checked", () => {
    const e = ex({});
    const a = adaptExercise(exerciseForPlayer(e), e, "challenge", [e], 1);
    expect(a.input).toBe("typed");
    expect(a.options).toEqual([]);
    expect(a.prompt).toBe(e.prompt);
    expect(checkAnswer(e, "Hello").verdict).toBe("correct");
    expect(checkAnswer(e, "helo").verdict).toBe("almost");
    expect(checkAnswer(e, "bye").verdict).toBe("wrong");
  });

  it("support: typed translations get a word bank with the answer's words and a few extras", () => {
    const t = ex({ type: "translate", prompt: "Translate: I like coffee", answer: "me gusta el café", options: [], audio: "" });
    const other = ex({ type: "translate", prompt: "Translate: I drink tea", answer: "bebo té", options: [], audio: "" });
    const a = adaptExercise(exerciseForPlayer(t), t, "support", [t, other], 2);
    expect(a.input).toBe("wordbank");
    expect(a.wordBank).toEqual(expect.arrayContaining(["me", "gusta", "el", "café"]));
    expect(a.wordBank.length).toBeGreaterThan(4);
    expect(adaptExercise(exerciseForPlayer(t), t, "normal", [t, other], 2).input).toBe("typed");
  });

  it("support: listening plays slowly first", () => {
    const l = ex({ type: "listen", text: "buenos días", audio: "buenos días" });
    expect(adaptExercise(exerciseForPlayer(l), l, "support", [l], 1).slowFirst).toBe(true);
    expect(adaptExercise(exerciseForPlayer(l), l, "normal", [l], 1).slowFirst).toBe(false);
  });
});

describe("weak words", () => {
  const card = (id: string, over: Partial<WeakCard> = {}): WeakCard => ({ id, term: `t${id}`, translation: `m${id}`, lapses: 0, difficulty: 3, stability: 20, reps: 5, ...over });

  it("puts forgotten and hard words first", () => {
    const cards = [card("a"), card("b", { lapses: 3 }), card("c", { difficulty: 9 }), card("d")];
    expect(pickWeakCards(cards, 2).map((c) => c.id)).toEqual(["b", "c"]);
  });

  it("asks each word one way, with meanings from the learner's other words", () => {
    const cards = ["a", "b", "c", "d", "e"].map((id) => card(id));
    const session = buildWeakSession(cards.slice(0, 3), cards, 7);
    expect(session.map((e) => e.kind)).toEqual(["choose", "listen", "type"]);
    expect(session[0].options).toContain("ma");
    expect(session[0].options).toHaveLength(4);
    expect(session[2]).toMatchObject({ shown: "mc", options: [] });
    expect(checkWeak(cards[2], "type", "TC").verdict).toBe("correct");
    expect(checkWeak(cards[0], "choose", "mb").verdict).toBe("wrong");
  });
});

describe("placement test", () => {
  const bank = CEFR_LEVELS.flatMap((level) => Array.from({ length: 4 }, () => ({ level })));
  const run = (knows: Cefr) => {
    let s: PlacementState = initialPlacement();
    for (let i = 0; i < 20; i++) {
      const id = nextQuestion(s, bank);
      if (id === null) break;
      const level = bank[id].level;
      s = recordAnswer(s, { id, level, correct: CEFR_LEVELS.indexOf(level) <= CEFR_LEVELS.indexOf(knows) }, bank);
    }
    return s;
  };

  it("climbs and stops at the learner's ceiling, in at most 12 questions", () => {
    for (const knows of CEFR_LEVELS) {
      const s = run(knows);
      expect(s.done).toBe(true);
      expect(s.answers.length).toBeLessThanOrEqual(12);
      expect(suggestedLevel(s.answers)).toBe(knows);
    }
  });

  it("suggests A1 when even A1 is hard", () => {
    expect(suggestedLevel([{ id: 0, level: "A1", correct: false }, { id: 1, level: "A1", correct: false }])).toBe("A1");
  });

  it("refuses a bank missing a level", () => {
    const items = (["A1", "A2", "B1", "B2", "C1"] as Cefr[]).flatMap((level) =>
      Array.from({ length: 4 }, () => ({ level, question: "q", audio: "", options: ["a", "b", "c"], answer: "a", explanation: "" })),
    );
    expect(() => normalizeBank(items)).toThrow(/C2/);
  });
});

describe("hints and glosses never give the answer away", () => {
  it("detects a hint that contains the answer", async () => {
    const { hintRevealsAnswer } = await import("@/lib/polylingue/service");
    expect(hintRevealsAnswer("Think of the greeting used in the morning.", "buenos días")).toBe(false);
    expect(hintRevealsAnswer("It starts with Buenos Dias…", "buenos días")).toBe(true);
    expect(hintRevealsAnswer("The verb is comer here.", "comer")).toBe(true);
  });

  it("only glosses lesson words unrelated to the answer", async () => {
    const { glossableWords } = await import("@/lib/polylingue/service");
    const words = [
      { term: "hola", translation: "hello" },
      { term: "adiós", translation: "goodbye" },
      { term: "gracias", translation: "thank you" },
    ];
    expect(glossableWords({ answer: "hello", accepted: [] }, words)).toEqual(["adiós", "gracias"]);
    expect(glossableWords({ answer: "Adiós, hasta mañana", accepted: [] }, words)).toEqual(["hola", "gracias"]);
  });
});
