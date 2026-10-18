import { prisma } from "@/lib/db";
import { ApiError, notFound } from "@/lib/api";
import { getGenerator } from "@/lib/ai";
import { CEFR_LEVELS, LEVELS, languageEnglishName } from "@/lib/polylingue/levels";
import { normalizeAnswer } from "@/lib/polylingue/check";
import { z } from "zod";
import { PER_LEVEL, bankForPlayer, normalizeBank, placementSchema, type PlacementItem } from "@/lib/polylingue/placement";

/** Placement test banks: written once per target and explanation language by the AI model, shared. */

const STALE_MS = 10 * 60 * 1000;

export async function placementBank(targetLang: string, baseLang: string) {
  const bank = await prisma.langPlacementBank.upsert({
    where: { targetLang_baseLang: { targetLang, baseLang } },
    create: { targetLang, baseLang },
    update: {},
  });
  if (bank.status !== "READY" || !bank.content) {
    void writeBank(bank.id).catch((err) => console.error("[polylingue] placement", bank.id, err));
    return { status: bank.status, error: bank.error, items: null };
  }
  return { status: bank.status, error: null, items: bankForPlayer(bank.content as unknown as PlacementItem[]) };
}

async function writeBank(bankId: string): Promise<void> {
  const claimed = await prisma.langPlacementBank.updateMany({
    where: { id: bankId, OR: [{ status: { in: ["QUEUED", "FAILED"] } }, { status: "GENERATING", updatedAt: { lt: new Date(Date.now() - STALE_MS) } }] },
    data: { status: "GENERATING", error: null },
  });
  if (claimed.count === 0) return;
  const bank = await prisma.langPlacementBank.findUniqueOrThrow({ where: { id: bankId } });
  const T = languageEnglishName(bank.targetLang);
  const B = languageEnglishName(bank.baseLang);
  const levels = CEFR_LEVELS.map((l) => `${l} (${LEVELS[l].name}): ${LEVELS[l].canDo} Grammar: ${LEVELS[l].grammar}.`).join("\n");
  try {
    const result = await (await getGenerator()).generate({
      feature: "polylingue",
      system: `You are an expert ${T} examiner writing a CEFR placement test. Each question must clearly belong to its level. Return ONLY one JSON object.`,
      user:
        `Write exactly ${PER_LEVEL} multiple-choice questions for each level A1, A2, B1, B2, C1 and C2 (${PER_LEVEL * CEFR_LEVELS.length} items):\n${levels}\n` +
        `Mix vocabulary, grammar (gap-fill sentences with ___), and short reading or listening comprehension. ` +
        `One question per level is a listening question: put the ${T} sentence to hear in "audio" (otherwise ""). ` +
        `Write the question in ${B} for A1–B1 and in ${T} for B2–C2. "options": 4 options, "answer": the exact text of the right one, ` +
        `"explanation": one short line (in the question's language). Levels must get clearly harder.`,
      schema: placementSchema,
      temperature: 0.4,
      maxTokens: 7000,
      mock: () => ({
        items: CEFR_LEVELS.flatMap((level) =>
          Array.from({ length: PER_LEVEL }, (_, i) => ({
            level,
            question: `${level} question ${i + 1}`,
            audio: i === 0 ? `${bank.targetLang} ${level} sentence` : "",
            options: ["right", "wrong 1", "wrong 2", "wrong 3"],
            answer: "right",
            explanation: `${level} rule`,
          })),
        ),
      }),
    });
    const items = normalizeBank(await reviewItems(bank.targetLang, result.data.items));
    await prisma.langPlacementBank.update({ where: { id: bankId }, data: { status: "READY", content: items as object, model: `${result.provider}:${result.model}` } });
  } catch (err) {
    await prisma.langPlacementBank.update({ where: { id: bankId }, data: { status: "FAILED", error: err instanceof Error ? err.message.slice(0, 500) : String(err) } });
  }
}

/** Checks one placement answer on the server. */
export async function checkPlacement(targetLang: string, baseLang: string, id: number, answer: string) {
  const bank = await prisma.langPlacementBank.findUnique({ where: { targetLang_baseLang: { targetLang, baseLang } } });
  if (!bank?.content) throw new ApiError(409, "The placement test is not ready", "not_ready");
  const item = (bank.content as unknown as PlacementItem[])[id];
  if (!item) throw notFound("Question");
  return { correct: normalizeAnswer(answer) === normalizeAnswer(item.answer), expected: item.answer, explanation: item.explanation };
}

const reviewSchema = z.object({ verdicts: z.array(z.object({ index: z.number().int().min(0), ok: z.boolean(), reason: z.string().max(200) })) });

/**
 * Second pass by the model, as a strict reviewer: a placement question with a
 * wrong, ambiguous or ill-formed answer would misjudge the learner, so flawed
 * items are dropped (normalizeBank then needs at least 2 per level).
 */
async function reviewItems(targetLang: string, items: PlacementItem[]): Promise<PlacementItem[]> {
  const T = languageEnglishName(targetLang);
  try {
    const result = await (await getGenerator()).generate({
      feature: "polylingue",
      system: `You are a strict native ${T} reviewer of CEFR placement tests. Return ONLY JSON.`,
      user:
        `For each numbered item, answer "ok": true only if the given answer is correct, standard ${T}, the ONLY correct option, ` +
        `the options are well-formed and distinct, and the item matches its level. Otherwise "ok": false with a short "reason".\n` +
        items.map((it, i) => `${i}. [${it.level}] ${it.question}${it.audio ? ` (audio: ${it.audio})` : ""} | options: ${it.options.join(" | ")} | answer: ${it.answer}`).join("\n"),
      schema: reviewSchema,
      temperature: 0,
      maxTokens: 3000,
      mock: () => ({ verdicts: items.map((_, index) => ({ index, ok: true, reason: "" })) }),
    });
    const bad = new Set(result.data.verdicts.filter((v) => !v.ok).map((v) => v.index));
    const kept = items.filter((_, i) => !bad.has(i));
    // Never leave a level with fewer than 2 questions: keep the level's flagged items rather than fail.
    const levels = new Set(items.map((i) => i.level));
    for (const level of levels) {
      if (kept.filter((i) => i.level === level).length < 2) {
        for (const [i, it] of items.entries()) if (it.level === level && bad.has(i) && kept.filter((k) => k.level === level).length < 2) kept.push(it);
      }
    }
    return kept;
  } catch {
    return items; // reviewer unavailable: keep the first draft
  }
}
