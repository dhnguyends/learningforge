/**
 * Cloze syntax shared by card validation (server) and the card viewer (UI).
 * Pure and dependency-free so client components can import it.
 *
 *   {{answer}}            → blank
 *   {{answer::hint}}      → blank showing the hint
 *   {{c1::answer::hint}}  → Anki-style numbered cloze
 */

export const CLOZE_BLANK = /\{\{(.*?)\}\}/g;

function parts(inner: string): { answer: string; hint?: string } {
  const segs = inner.split("::");
  const body = /^c\d+$/i.test(segs[0]?.trim() ?? "") ? segs.slice(1) : segs;
  const hint = body[1]?.trim();
  return { answer: (body[0] ?? "").trim(), ...(hint ? { hint } : {}) };
}

/** The answer inside a cloze blank. */
export function clozeAnswer(inner: string): string {
  return parts(inner).answer;
}

export function hasCloze(text: string): boolean {
  return /\{\{.*?\}\}/.test(text);
}

/** Front side: every blank hidden ("[ … ]", or "[ hint ]" when a hint is given). */
export function clozeFront(text: string): string {
  return text.replace(CLOZE_BLANK, (_m, inner: string) => `**[ ${parts(inner).hint ?? "…"} ]**`);
}

/** Back side: every blank filled with its answer, highlighted. */
export function clozeBack(text: string): string {
  return text.replace(CLOZE_BLANK, (_m, inner: string) => {
    const { answer } = parts(inner);
    return answer ? `**${answer}**` : "**[ … ]**";
  });
}
