/**
 * Plain-text editing tools for the source text editor (transcripts, OCR text,
 * translations). Pure functions, so the editor stays simple and they can be
 * tested on their own.
 */

export type CaseStyle = "upper" | "lower" | "sentence" | "title";

/** Change the case of a piece of text, in the text's language (Turkish "i", German "ß"…). */
export function changeCase(text: string, style: CaseStyle, lang?: string): string {
  const locale = lang || undefined;
  switch (style) {
    case "upper":
      return text.toLocaleUpperCase(locale);
    case "lower":
      return text.toLocaleLowerCase(locale);
    case "sentence": {
      const lower = text.toLocaleLowerCase(locale);
      // First letter of the text and of every sentence.
      return lower.replace(/(^\s*|[.!?…]\s+|\n\s*)(\p{L})/gu, (_m, before: string, letter: string) => before + letter.toLocaleUpperCase(locale));
    }
    case "title":
      return text
        .toLocaleLowerCase(locale)
        .replace(/(^|[\s\-–—("«“/])(\p{L})/gu, (_m, before: string, letter: string) => before + letter.toLocaleUpperCase(locale));
  }
}

/** "remov- ing", "remov-\ning" or "remov¬ ing" (line-end hyphenation from scans) → "removing". */
export function joinBrokenWords(text: string): string {
  return text.replace(/(\p{Ll})[-¬‐](\s*)(\p{Ll}+)/gu, (m, a: string, space: string, b: string) =>
    // "pre- and post-war" keeps its hyphen.
    space && !CONJUNCTIONS.has(b) ? a + b : m,
  );
}
const CONJUNCTIONS = new Set(["and", "or", "nor", "to", "et", "ou", "und", "oder", "bis", "y", "e", "o", "u", "a"]);

/**
 * Lines broken in the middle of a sentence (scans, subtitles) are joined;
 * a blank line, or a line ending a sentence before a capital, stays a paragraph break.
 */
export function joinBrokenLines(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((para) => para.replace(/([^.!?:…»”"\n])[ \t]*\n[ \t]*(?=\S)/gu, "$1 "))
    .join("\n\n");
}

/** Repeated spaces and tabs → one space; no space before , . ) and none after ( (French keeps its space before ; : ! ? »). */
export function tidySpaces(text: string, lang?: string): string {
  let out = text.replace(/[ \t ]{2,}/g, " ").replace(/ +\n/g, "\n").replace(/\n +/g, "\n");
  out = out.replace(/ +([,.)\]])/g, "$1").replace(/([(\[]) +/g, "$1");
  if (!lang?.startsWith("fr")) out = out.replace(/ +([;:!?])/g, "$1");
  return out.trim();
}

/** All clean-ups for text from OCR or automatic transcription. */
export function cleanUpText(text: string, lang?: string): string {
  return tidySpaces(joinBrokenLines(joinBrokenWords(text)), lang);
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

export interface FindOptions {
  matchCase?: boolean;
  wholeWord?: boolean;
}

/** The query as a global regular expression (literal text, never a pattern typed by the user). */
export function findPattern(query: string, options: FindOptions = {}): RegExp | null {
  if (!query) return null;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const body = options.wholeWord ? `(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])` : escaped;
  return new RegExp(body, `gu${options.matchCase ? "" : "i"}`);
}

/** Start offsets of every match of the query in the text. */
export function findMatches(text: string, query: string, options: FindOptions = {}): number[] {
  const re = findPattern(query, options);
  if (!re) return [];
  return [...text.matchAll(re)].map((m) => m.index ?? 0);
}

/** Replace every match; `$` in the replacement is kept literally. */
export function replaceAll(text: string, query: string, replacement: string, options: FindOptions = {}): { text: string; count: number } {
  const re = findPattern(query, options);
  if (!re) return { text, count: 0 };
  let count = 0;
  const out = text.replace(re, () => {
    count++;
    return replacement;
  });
  return { text: out, count };
}

/** Special characters offered by the editor, grouped. */
export const SPECIAL_CHARACTERS: { label: string; chars: string[] }[] = [
  { label: "Quotes and dashes", chars: ["«", "»", "“", "”", "‘", "’", "„", "‹", "›", "–", "—", "…", "·", "•"] },
  { label: "Accents", chars: ["é", "è", "ê", "ë", "à", "â", "ä", "î", "ï", "ô", "ö", "ù", "û", "ü", "ç", "ñ", "œ", "æ", "ß", "É", "È", "À", "Ç", "Œ"] },
  { label: "Other languages", chars: ["á", "í", "ó", "ú", "ã", "õ", "å", "ø", "ł", "ś", "ž", "č", "ğ", "ş", "ı", "¿", "¡"] },
  { label: "Symbols", chars: ["°", "€", "£", "$", "%", "§", "©", "®", "™", "±", "×", "÷", "≈", "≠", "≤", "≥", "→", "←", "½", "¼", "²", "³"] },
];
