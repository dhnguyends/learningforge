/**
 * Fast, dependency-free language detection for extracted text: counts very
 * frequent function words of each supported language. Good enough to tell a
 * French lecture from an English one (what bilingual sources need); short or
 * mixed text returns null rather than guessing.
 */
export type SourceLanguage = "fr" | "en";

const STOPWORDS: Record<SourceLanguage, Set<string>> = {
  fr: new Set(
    "le la les des une un du de et est sont pour que qui dans sur avec pas plus par au aux ce cette ces il elle nous vous ils sont été être avoir fait mais ou donc car leur leurs son sa ses on se ne très".split(" "),
  ),
  en: new Set(
    "the a an of and is are for that which who in on with not more by to this these it he she we you they was were be have has been but or so because their his her its as at from will would can".split(" "),
  ),
};

export function detectLanguage(text: string): SourceLanguage | null {
  const words = text
    .toLowerCase()
    .replace(/[^a-zàâäçéèêëîïôöùûüœæ'\s-]/gi, " ")
    .split(/[\s'’-]+/)
    .filter(Boolean)
    .slice(0, 4000);
  if (words.length < 12) return null;
  const score = (lang: SourceLanguage) => words.reduce((n, w) => n + (STOPWORDS[lang].has(w) ? 1 : 0), 0);
  const fr = score("fr");
  const en = score("en");
  const total = fr + en;
  if (total < 5) return null;
  if (fr / total >= 0.65) return "fr";
  if (en / total >= 0.65) return "en";
  return null;
}

/** Normalises a Whisper/BCP-47 tag ("fr", "fr-FR", "french") to a supported language. */
export function normalizeLanguage(tag: string | null | undefined): SourceLanguage | null {
  const t = (tag ?? "").toLowerCase();
  if (t.startsWith("fr")) return "fr";
  if (t.startsWith("en")) return "en";
  return null;
}

export const LANGUAGE_LABELS: Record<SourceLanguage, string> = { fr: "Français", en: "English" };
