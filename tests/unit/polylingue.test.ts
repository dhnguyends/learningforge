import { describe, it, expect } from "vitest";
import { checkAnswer, checkText, levenshtein, normalizeAnswer } from "@/lib/polylingue/check";
import { answerXp, currentStreak, dayKey, lessonBonus, nextStreak, previousDay, XP } from "@/lib/polylingue/progress";
import { exerciseForPlayer, normalizeExercise, normalizeLesson, type Exercise } from "@/lib/polylingue/content";
import { CEFR_LEVELS, EXERCISE_TYPES, LEVELS, curriculumBaseLang, isImmersion } from "@/lib/polylingue/levels";

const ex = (over: Partial<Exercise>): Exercise => ({
  type: "translate",
  prompt: "Translate: good morning",
  text: "",
  answer: "buenos días",
  accepted: [],
  options: [],
  pairs: [],
  explanation: "",
  audio: "",
  ...over,
});

describe("answer checking", () => {
  it("ignores case, spaces and punctuation", () => {
    expect(normalizeAnswer("  ¡Buenos   Días! ")).toBe("buenos días");
    expect(checkText("Buenos días.", "buenos días").verdict).toBe("correct");
  });

  it("calls a missing accent or a small typo 'almost', with the right spelling", () => {
    expect(checkText("buenos dias", "buenos días")).toMatchObject({ verdict: "almost", expected: "buenos días", note: "Watch the accents." });
    expect(checkText("buenos díaz", "buenos días")).toMatchObject({ verdict: "almost", note: "Small typo." });
    expect(checkText("buenas noches", "buenos días").verdict).toBe("wrong");
    expect(checkText("", "buenos días").verdict).toBe("wrong");
  });

  it("accepts the alternatives given with the lesson", () => {
    expect(checkText("hola", "buenos días", ["hola"]).verdict).toBe("correct");
  });

  it("does not forgive typos in very short words", () => {
    expect(checkText("si", "no").verdict).toBe("wrong");
    expect(levenshtein("kitten", "sitting")).toBe(3);
  });

  it("checks each exercise type", () => {
    expect(checkAnswer(ex({ type: "choice", answer: "hello", options: ["hello", "bye", "thanks"] }), "hello").verdict).toBe("correct");
    expect(checkAnswer(ex({ type: "choice", answer: "hello", options: ["hello", "bye", "thanks"] }), "bye").verdict).toBe("wrong");
    const match = ex({ type: "match", pairs: [{ left: "a", right: "1" }, { left: "b", right: "2" }, { left: "c", right: "3" }] });
    expect(checkAnswer(match, "0").verdict).toBe("correct");
    expect(checkAnswer(match, "2").verdict).toBe("almost");
    expect(checkAnswer(match, "3").verdict).toBe("wrong");
    expect(checkAnswer(ex({ type: "order", answer: "yo como pan" }), "Yo como pan").verdict).toBe("correct");
    expect(checkAnswer(ex({ type: "cloze", text: "Yo {{como}} pan", answer: "como", options: ["como", "bebo"] }), "bebo").verdict).toBe("wrong");
  });
});

describe("XP and streaks", () => {
  it("gives XP for answers, retries and finished lessons", () => {
    expect(answerXp("correct", false)).toBe(XP.correct);
    expect(answerXp("almost", false)).toBe(XP.almost);
    expect(answerXp("wrong", false)).toBe(0);
    expect(answerXp("correct", true)).toBe(XP.retry);
    expect(lessonBonus(100)).toBe(XP.lessonComplete + XP.perfectLesson);
    expect(lessonBonus(80)).toBe(XP.lessonComplete);
  });

  it("counts days in the learner's time zone", () => {
    const lateEvening = new Date("2026-10-16T21:30:00Z"); // 23:30 in Paris, 17:30 in New York
    expect(dayKey(lateEvening, "Europe/Paris")).toBe("2026-10-16");
    expect(dayKey(new Date("2026-10-16T23:30:00Z"), "Europe/Paris")).toBe("2026-10-17");
    expect(dayKey(new Date("2026-10-16T23:30:00Z"), "America/New_York")).toBe("2026-10-16");
    expect(dayKey(lateEvening, "Not/AZone")).toBe("2026-10-16");
    expect(previousDay("2026-03-01")).toBe("2026-02-28");
  });

  it("grows a streak day after day, keeps it today, and restarts after a missed day", () => {
    expect(nextStreak(null, "2026-10-16", 0)).toBe(1);
    expect(nextStreak("2026-10-16", "2026-10-16", 4)).toBe(4);
    expect(nextStreak("2026-10-15", "2026-10-16", 4)).toBe(5);
    expect(nextStreak("2026-10-13", "2026-10-16", 4)).toBe(1);
    expect(currentStreak("2026-10-15", "2026-10-16", 4)).toBe(4); // still alive until tonight
    expect(currentStreak("2026-10-14", "2026-10-16", 4)).toBe(0);
  });
});

describe("lesson content", () => {
  it("puts the answer among at most 4 options", () => {
    const e = normalizeExercise(ex({ type: "choice", answer: "hello", options: ["bye", "thanks", "please", "sorry", "yes"] }))!;
    expect(e.options).toHaveLength(4);
    expect(e.options).toContain("hello");
  });

  it("drops exercises that cannot be played", () => {
    expect(normalizeExercise(ex({ type: "choice", answer: "hello", options: ["hello"] }))).toBeNull();
    expect(normalizeExercise(ex({ type: "match", pairs: [{ left: "a", right: "1" }] }))).toBeNull();
    expect(normalizeExercise(ex({ type: "cloze", text: "no blank here", answer: "x" }))).toBeNull();
    expect(normalizeExercise(ex({ type: "order", answer: "two words" }))).toBeNull();
    expect(normalizeExercise(ex({ type: "listen", answer: "a", options: ["a", "b", "c"], text: "", audio: "" }))).toBeNull();
  });

  it("hides the answers from the player", () => {
    const cloze = exerciseForPlayer(normalizeExercise(ex({ type: "cloze", text: "Yo {{como}} pan", answer: "como" }))!);
    expect(cloze.text).toBe("Yo ____ pan");
    expect(JSON.stringify(cloze)).not.toContain("como");
    const order = exerciseForPlayer(normalizeExercise(ex({ type: "order", answer: "yo como pan" }))!);
    expect(order.text).toBe("");
    expect(order.tokens.sort()).toEqual(["como", "pan", "yo"]);
  });

  it("refuses a lesson with too few usable exercises", () => {
    expect(() =>
      normalizeLesson({ intro: "x", words: [{ term: "a", translation: "b", example: "", exampleTranslation: "", partOfSpeech: "" }], exercises: [ex({})] }),
    ).toThrow(/usable exercises/);
  });

  it("has a profile for every level, harder as the level rises", () => {
    for (const l of CEFR_LEVELS) {
      const p = LEVELS[l];
      expect(Object.keys(p.mix).sort()).toEqual([...EXERCISE_TYPES].sort());
      expect(p.units * p.lessonsPerUnit).toBeGreaterThanOrEqual(20);
    }
    expect(LEVELS.A1.maxSentenceWords).toBeLessThan(LEVELS.B1.maxSentenceWords);
    expect(LEVELS.B1.maxSentenceWords).toBeLessThan(LEVELS.C2.maxSentenceWords);
    expect(LEVELS.A1.mix.choice).toBeGreaterThan(LEVELS.C1.mix.choice);
    expect(LEVELS.A1.mix.translate).toBeLessThan(LEVELS.C1.mix.translate);
  });
});

describe("immersion from B2", () => {
  it("teaches B2, C1 and C2 in the language learned", () => {
    expect(CEFR_LEVELS.filter(isImmersion)).toEqual(["B2", "C1", "C2"]);
    expect(curriculumBaseLang("es", "en", "B1")).toBe("en");
    expect(curriculumBaseLang("es", "en", "B2")).toBe("es");
    expect(curriculumBaseLang("es", "fr", "C2")).toBe("es");
  });
});

describe("multi-skill practice", () => {
  it("scores a spoken sentence word by word, ignoring case, punctuation and accents", async () => {
    const { scoreSpoken } = await import("@/lib/polylingue/practice");
    expect(scoreSpoken("¡Buenos días, señora!", "buenos dias senora")).toMatchObject({ score: 100, missed: [] });
    expect(scoreSpoken("Me llamo Ana y vivo en Madrid", "me llamo ana vivo en madrid")).toMatchObject({ score: 86, missed: ["y"] });
    expect(scoreSpoken("Hola", "")).toMatchObject({ score: 0, missed: ["hola"] });
  });

  it("never sends answers, dictation text or model answers to the browser", async () => {
    const { practiceForPlayer } = await import("@/lib/polylingue/practice");
    const q = { question: "Q?", options: ["a", "b", "c"], answer: "a", explanation: "because" };
    const listening = practiceForPlayer("LISTENING", { title: "T", dictation: ["secret one"], passage: ["secret two"], questions: [q] });
    expect(JSON.stringify(listening)).not.toMatch(/secret|because|"answer"/);
    expect(listening).toMatchObject({ dictationCount: 1, passageCount: 1 });
    const writing = practiceForPlayer("WRITING", { tasks: [{ prompt: "P", minWords: 10, maxWords: 20, hints: [], model: "secret model" }] });
    expect(JSON.stringify(writing)).not.toContain("secret");
    const reading = practiceForPlayer("READING", { title: "T", text: "text", glossary: [{ term: "x", meaning: "y" }], questions: [q] });
    expect(JSON.stringify(reading)).not.toMatch(/because|"answer"/);
  });

  it("puts each question's answer among its options", async () => {
    const { normalizePractice } = await import("@/lib/polylingue/practice");
    const r = normalizePractice("READING", {
      title: "T",
      text: "some text here",
      glossary: [],
      questions: [{ question: "Q?", options: ["b", "c", "d", "e"], answer: "a", explanation: "" }],
    }) as { questions: { options: string[] }[] };
    expect(r.questions[0].options).toContain("a");
    expect(r.questions[0].options).toHaveLength(4);
  });
});

describe("citation artefacts in generated texts", () => {
  it("removes [Source n] style markers and keeps the text intact", async () => {
    const { stripSourceMarkers, cleanGenerated } = await import("@/lib/polylingue/content");
    expect(stripSourceMarkers("Their legacy speaks volumes about their organizational genius [Source 1].")).toBe("Their legacy speaks volumes about their organizational genius.");
    expect(stripSourceMarkers("Rome fell in 476 [Sources 2–3], and Byzantium lasted [source 4] longer (Source 5).")).toBe("Rome fell in 476, and Byzantium lasted longer.");
    expect(stripSourceMarkers("As shown [1, 2], growth slowed [3].")).toBe("As shown, growth slowed.");
    expect(stripSourceMarkers("Según la fuente [Fuente 2], el museo abre.")).toBe("Según la fuente, el museo abre.");
    // Ordinary brackets and numbers stay.
    expect(stripSourceMarkers("Chapter 3 (pages 10–12) explains [the theory].")).toBe("Chapter 3 (pages 10–12) explains [the theory].");
    expect(cleanGenerated({ text: "A [Source 1].", questions: [{ explanation: "See [2]." }], n: 3 })).toEqual({ text: "A.", questions: [{ explanation: "See." }], n: 3 });
  });
});

describe("OCR language", () => {
  it("uses the document's language model, English + French when unknown", async () => {
    const { ocrLanguageFor } = await import("@/lib/documents/parse");
    expect(ocrLanguageFor("fr")).toBe("fra");
    expect(ocrLanguageFor("en-US")).toBe("eng");
    expect(ocrLanguageFor("es")).toBe("spa");
    expect(ocrLanguageFor(null)).toBe("eng+fra");
    expect(ocrLanguageFor("zh")).toBe("eng+fra");
  });
});

describe("OCR never degrades a good text layer", () => {
  it("scores real words high and illustration noise low", async () => {
    const { wordQuality, ocrIsBetter } = await import("@/lib/documents/parse");
    const layer = "What can the gods of private equity teach us about managing for the long term? If you think that their approach has nothing to tell us, you'd be wrong.";
    const noise = "nil . - Rane ols Ea oie TGF a hi sat aa bs ds J BE ET Be on aa bee HESERE : . TT rom mew GUN — iy mE Be Eee Whol SEG GEE";
    expect(wordQuality(layer)).toBeGreaterThan(0.85);
    expect(wordQuality(noise)).toBeLessThan(0.7);
    expect(ocrIsBetter(noise + " " + noise, layer, 80)).toBe(false);
    expect(ocrIsBetter(layer, "", 80)).toBe(true); // a page without a text layer
    expect(ocrIsBetter(layer, "gods  priv8 eq|uity tea ch u s ab0ut mana ging f0r th3 l0ng t3rm", 85)).toBe(true); // garbled layer
    expect(ocrIsBetter(layer, "", 30)).toBe(false); // OCR not confident
  });
});
