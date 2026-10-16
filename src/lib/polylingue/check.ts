import type { Exercise } from "@/lib/polylingue/content";

/**
 * Instant correction of an answer: forgiving about case, spaces and
 * punctuation; "almost" for a missing or wrong accent or a small typo, with
 * the correct spelling shown; "wrong" otherwise.
 */
export type Verdict = "correct" | "almost" | "wrong";

export interface CheckResult {
  verdict: Verdict;
  /** The correct answer, as it should be written. */
  expected: string;
  /** Why it is "almost": accents or a typo. */
  note?: string;
}

export function normalizeAnswer(s: string): string {
  return s
    .normalize("NFC")
    .toLowerCase()
    .replace(/[’`´]/g, "'")
    .replace(/[.,!?¡¿;:"«»“”…()[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function foldAccents(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/ß/g, "ss");
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** Typo tolerance: 1 edit up to 8 characters, then about one per 8. */
function typoBudget(length: number): number {
  return length <= 3 ? 0 : length <= 8 ? 1 : Math.min(3, Math.floor(length / 8) + 1);
}

/** Free-text answers (translate, cloze without options, order). */
export function checkText(given: string, answer: string, accepted: string[] = []): CheckResult {
  const g = normalizeAnswer(given);
  const candidates = [answer, ...accepted];
  if (!g) return { verdict: "wrong", expected: answer };
  if (candidates.some((c) => normalizeAnswer(c) === g)) return { verdict: "correct", expected: answer };
  const gf = foldAccents(g);
  const accentHit = candidates.find((c) => foldAccents(normalizeAnswer(c)) === gf);
  if (accentHit) return { verdict: "almost", expected: accentHit, note: "Watch the accents." };
  const typoHit = candidates.find((c) => {
    const cf = foldAccents(normalizeAnswer(c));
    return levenshtein(gf, cf) <= typoBudget(cf.length);
  });
  if (typoHit) return { verdict: "almost", expected: typoHit, note: "Small typo." };
  return { verdict: "wrong", expected: answer };
}

/**
 * Checks the learner's answer to an exercise.
 * - choice / listen / cloze: the chosen option, or the typed answer (challenge mode)
 * - match: the number of wrong taps before all pairs were matched
 * - order, translate: the text typed or built (word bank in support mode)
 */
export function checkAnswer(e: Exercise, given: string): CheckResult {
  switch (e.type) {
    case "choice":
    case "listen":
    case "cloze": {
      // A chosen option is compared exactly; a typed answer (challenge mode, or
      // a fill-in without options) gets the usual accent and typo tolerance.
      const chosen = e.options.some((o) => normalizeAnswer(o) === normalizeAnswer(given));
      if (chosen) return normalizeAnswer(given) === normalizeAnswer(e.answer) ? { verdict: "correct", expected: e.answer } : { verdict: "wrong", expected: e.answer };
      return checkText(given, e.answer, e.accepted);
    }
    case "match": {
      const mistakes = Math.max(0, Number.parseInt(given, 10) || 0);
      const expected = e.pairs.map((p) => `${p.left} = ${p.right}`).join(" · ");
      return { verdict: mistakes === 0 ? "correct" : mistakes <= 2 ? "almost" : "wrong", expected };
    }
    default:
      return checkText(given, e.answer, e.accepted);
  }
}
