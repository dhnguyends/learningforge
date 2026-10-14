/**
 * Print retrieval scores for on-topic, paraphrased, cross-language and
 * off-topic questions against one study set — use it to pick
 * RETRIEVAL_MIN_SCORE for an embeddings model (relevant hits should clear the
 * floor, off-topic questions should not).
 *
 *   npx tsx scripts/calibrate-retrieval.ts <studySetId> ["question" ...]
 */
import { prisma } from "@/lib/db";
import { searchChunks } from "@/lib/retrieval";
import { getEmbeddings, retrievalMinScore } from "@/lib/ai/embeddings";

const DEFAULT_QUESTIONS = [
  "What is the impedance of an ideal capacitor?",
  "Why does a capacitor stop direct current from passing?",
  "Quelle est l'impédance d'un condensateur ?",
  "How does a diode behave when forward biased?",
  "Who won the football world cup in 2018?",
  "What is a good recipe for chocolate cake?",
  "Explain photosynthesis in plants.",
];

async function main() {
  const [setId, ...custom] = process.argv.slice(2);
  if (!setId) throw new Error("usage: calibrate-retrieval.ts <studySetId> [questions...]");
  const questions = custom.length ? custom : DEFAULT_QUESTIONS;
  console.log(`model ${getEmbeddings().name}, current floor ${retrievalMinScore()}`);
  for (const q of questions) {
    const hits = await searchChunks(setId, q, { k: 3, minScore: 0 });
    const top = hits.map((h) => `${h.score.toFixed(3)}${h.page != null ? `@p${h.page}` : ""}`).join("  ");
    console.log(`${top.padEnd(36)} ${q}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
