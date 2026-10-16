import { checkText, normalizeAnswer, type CheckResult } from "@/lib/polylingue/check";

/**
 * "Practise weak words": a short session built from the learner's own words
 * (no AI), those forgotten or missed most. Each word is asked one way:
 * meaning → choose (recognition), audio → choose (listening), meaning → type
 * the word (production). Answers grade the word's spaced-repetition card.
 */
export interface WeakCard {
  id: string;
  term: string;
  translation: string;
  lapses: number;
  difficulty: number | null;
  stability: number | null;
  reps: number;
}

export type WeakKind = "choose" | "listen" | "type";

export interface WeakExercise {
  cardId: string;
  kind: WeakKind;
  /** Shown to the learner: the word (choose), nothing (listen), or the meaning (type). */
  shown: string;
  /** Target-language text read aloud (choose, listen). */
  audio: string;
  /** Meanings to choose from (choose, listen). */
  options: string[];
}

/** Weakness: forgotten often, hard (FSRS difficulty), little stability, few reviews. */
export function weakness(c: WeakCard): number {
  return c.lapses * 3 + (c.difficulty ?? 5) + (c.stability == null ? 2 : Math.max(0, 4 - Math.log2(1 + c.stability))) + (c.reps < 2 ? 1 : 0);
}

export function pickWeakCards(cards: WeakCard[], limit = 10): WeakCard[] {
  return [...cards].sort((a, b) => weakness(b) - weakness(a) || a.term.localeCompare(b.term)).slice(0, limit);
}

function seeded(seed: number) {
  let s = (seed * 9301 + 49297) % 233280;
  return () => (s = (s * 9301 + 49297) % 233280) / 233280;
}

/** Builds the session; distractor meanings come from the learner's other words. */
export function buildWeakSession(weak: WeakCard[], all: WeakCard[], seed = 1): WeakExercise[] {
  const rnd = seeded(seed);
  const kinds: WeakKind[] = ["choose", "listen", "type"];
  return weak.map((c, i) => {
    const kind = kinds[i % kinds.length];
    if (kind === "type") return { cardId: c.id, kind, shown: c.translation, audio: "", options: [] };
    const pool = [...new Set(all.filter((o) => o.id !== c.id).map((o) => o.translation))].filter(
      (t) => normalizeAnswer(t) !== normalizeAnswer(c.translation),
    );
    const distractors = pool.sort(() => rnd() - 0.5).slice(0, 3);
    const options = [...distractors, c.translation].sort(() => rnd() - 0.5);
    return { cardId: c.id, kind, shown: kind === "choose" ? c.term : "", audio: c.term, options };
  });
}

/** Checks an answer: a chosen meaning exactly, a typed word with accent and typo tolerance. */
export function checkWeak(card: Pick<WeakCard, "term" | "translation">, kind: WeakKind, given: string): CheckResult {
  if (kind === "type") return checkText(given, card.term);
  return normalizeAnswer(given) === normalizeAnswer(card.translation)
    ? { verdict: "correct", expected: card.translation }
    : { verdict: "wrong", expected: card.translation };
}
