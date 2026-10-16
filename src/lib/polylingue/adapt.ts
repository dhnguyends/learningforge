import type { Exercise, PlayerExercise } from "@/lib/polylingue/content";
import type { Verdict } from "@/lib/polylingue/check";

/**
 * Adaptive difficulty, always inside the level the learner chose: the content
 * (words, grammar, sentences) stays that level's; only how an exercise is
 * presented changes with recent performance.
 *
 * - support   (recent accuracy < 60 %): typed answers get a word bank to build
 *             the answer from; listening plays slowly first.
 * - normal
 * - challenge (recent accuracy ≥ 90 %): multiple-choice and fill-in answers
 *             must be typed, without the options.
 *
 * The level itself never changes automatically (the placement test only
 * suggests one; the learner decides).
 */
export type Mode = "support" | "normal" | "challenge";

export const MODE_WINDOW = 40;
const MIN_ATTEMPTS = 10;

/** Accuracy (0–1) of verdicts: correct = 1, almost = ½, wrong = 0. */
export function accuracy(verdicts: Verdict[]): number | null {
  if (verdicts.length === 0) return null;
  return verdicts.reduce((n, v) => n + (v === "correct" ? 1 : v === "almost" ? 0.5 : 0), 0) / verdicts.length;
}

/** The mode for the learner's last answers (most recent first, at most MODE_WINDOW used). */
export function modeFor(recent: Verdict[]): Mode {
  const window = recent.slice(0, MODE_WINDOW);
  if (window.length < MIN_ATTEMPTS) return "normal";
  const a = accuracy(window) ?? 0;
  return a >= 0.9 ? "challenge" : a < 0.6 ? "support" : "normal";
}

export const MODE_LABELS: Record<Mode, { label: string; description: string }> = {
  support: { label: "Support", description: "Word banks and slower audio help you while you consolidate this level." },
  normal: { label: "Standard", description: "The usual mix for your level." },
  challenge: { label: "Challenge", description: "You are doing great: type the answers instead of choosing them." },
};

function tokens(s: string): string[] {
  return s.split(/\s+/).filter(Boolean);
}

/** Deterministic shuffle so a lesson reloads the same way. */
function shuffle<T>(items: T[], seed: number): T[] {
  const out = [...items];
  let s = (seed * 9301 + 49297) % 233280;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export interface AdaptedFields {
  /** How the player asks for the answer. */
  input: "options" | "typed" | "wordbank" | "order" | "match";
  /** Words to build the answer from (support mode, typed exercises). */
  wordBank: string[];
  /** Play the audio slowly first (support mode). */
  slowFirst: boolean;
}

/**
 * Adapts one player exercise to the mode. `all` is the lesson's exercises, used
 * to pick distractor words for word banks from the same lesson (same level).
 */
export function adaptExercise(player: PlayerExercise, source: Exercise, mode: Mode, all: Exercise[], seed: number): PlayerExercise & AdaptedFields {
  const base: AdaptedFields = {
    input: player.type === "match" ? "match" : player.type === "order" ? "order" : player.options.length > 0 ? "options" : "typed",
    wordBank: [],
    slowFirst: mode === "support" && (player.type === "listen" || player.type === "choice"),
  };
  if (mode === "challenge" && (player.type === "choice" || (player.type === "cloze" && player.options.length > 0))) {
    // Recognition becomes production, on the same content.
    return { ...player, options: [], ...base, input: "typed" };
  }
  if (mode === "support" && base.input === "typed" && (player.type === "translate" || player.type === "cloze")) {
    const answerTokens = tokens(source.answer);
    if (answerTokens.length >= 1 && answerTokens.length <= 14) {
      const others = all
        .filter((e) => e !== source && (e.type === source.type || e.type === "order"))
        .flatMap((e) => tokens(e.answer))
        .filter((t) => !answerTokens.some((a) => a.toLowerCase() === t.toLowerCase()));
      const distractors = shuffle([...new Set(others)], seed).slice(0, Math.min(3, Math.max(1, Math.ceil(answerTokens.length / 2))));
      return { ...player, ...base, input: "wordbank", wordBank: shuffle([...answerTokens, ...distractors], seed + 3) };
    }
  }
  return { ...player, ...base };
}
