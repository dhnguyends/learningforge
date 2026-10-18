import { AsyncLocalStorage } from "node:async_hooks";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";

/**
 * Tokens of every AI model call, for the real cost of each course.
 *
 * Callers say what they are working on with withAiUsage({ studySetId,
 * feature }) — the job runner does it for every job — and every generation
 * inside records its provider, model and tokens (the generator wrapper in
 * src/lib/ai/index.ts, the local translator). Recording never fails a call.
 */
export interface AiUsageContext {
  studySetId?: string | null;
  userId?: string | null;
  feature?: string;
}

const context = new AsyncLocalStorage<AiUsageContext>();

/** Runs `fn` with this course / feature attached to the AI calls it makes (nested contexts add to the outer one). */
export function withAiUsage<T>(ctx: AiUsageContext, fn: () => Promise<T>): Promise<T> {
  return context.run({ ...context.getStore(), ...Object.fromEntries(Object.entries(ctx).filter(([, v]) => v !== undefined)) }, fn);
}

/** Like withAiUsage, for work on a source: its course is looked up. */
export async function withSourceAiUsage<T>(sourceId: string, feature: string, fn: () => Promise<T>): Promise<T> {
  const source = await prisma.source.findUnique({ where: { id: sourceId }, select: { studySetId: true } }).catch(() => null);
  return withAiUsage({ studySetId: source?.studySetId ?? null, feature }, fn);
}

export async function recordAiUsage(call: {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Characters billed by a per-character service (Azure AI Translator). */
  characters?: number;
  feature?: string;
}): Promise<void> {
  if (call.provider === "mock") return; // offline demo and tests: no cost
  const ctx = context.getStore() ?? {};
  try {
    await prisma.aiUsage.create({
      data: {
        studySetId: ctx.studySetId ?? null,
        userId: ctx.userId ?? null,
        feature: ctx.feature ?? call.feature ?? "other",
        provider: call.provider,
        model: call.model,
        inputTokens: Math.max(0, Math.round(call.inputTokens || 0)),
        outputTokens: Math.max(0, Math.round(call.outputTokens || 0)),
        characters: Math.max(0, Math.round(call.characters || 0)),
      },
    });
  } catch (err) {
    console.warn("[ai-usage] could not record a call:", err instanceof Error ? err.message : err);
  }
}

/** Z.ai Coding Plan credits for these tokens (an estimate: ZAI_TOKENS_PER_CREDIT). */
export function zaiCredits(tokens: number, tokensPerCredit = getEnv().ZAI_TOKENS_PER_CREDIT): number {
  return Math.round((tokens / tokensPerCredit) * 10) / 10;
}

export interface CourseAiCost {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** Characters sent to Azure AI Translator (billed per character). */
  characters: number;
  since: string | null;
  /** Estimated Z.ai credits, for the calls made with GLM on Z.ai (null when none). */
  zaiCredits: number | null;
  tokensPerCredit: number;
  byFeature: { feature: string; calls: number; tokens: number; characters: number }[];
  byModel: { provider: string; model: string; calls: number; tokens: number; characters: number; zaiCredits: number | null }[];
}

/** What a course's AI calls cost so far (study material, tutor, translations). */
export async function courseAiCost(studySetId: string): Promise<CourseAiCost> {
  const rows = await prisma.aiUsage.findMany({
    where: { studySetId },
    select: { feature: true, provider: true, model: true, inputTokens: true, outputTokens: true, characters: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  return summarizeAiUsage(rows);
}

/** Pure: totals of usage rows, by feature and by model. */
export function summarizeAiUsage(
  rows: { feature: string; provider: string; model: string; inputTokens: number; outputTokens: number; characters?: number; createdAt: Date }[],
  tokensPerCredit = getEnv().ZAI_TOKENS_PER_CREDIT,
): CourseAiCost {
  const byFeature = new Map<string, { calls: number; tokens: number; characters: number }>();
  const byModel = new Map<string, { provider: string; model: string; calls: number; tokens: number; characters: number }>();
  let inputTokens = 0;
  let outputTokens = 0;
  let characters = 0;
  for (const r of rows) {
    const tokens = r.inputTokens + r.outputTokens;
    const chars = r.characters ?? 0;
    inputTokens += r.inputTokens;
    outputTokens += r.outputTokens;
    characters += chars;
    const f = byFeature.get(r.feature) ?? { calls: 0, tokens: 0, characters: 0 };
    byFeature.set(r.feature, { calls: f.calls + 1, tokens: f.tokens + tokens, characters: f.characters + chars });
    const key = `${r.provider}:${r.model}`;
    const m = byModel.get(key) ?? { provider: r.provider, model: r.model, calls: 0, tokens: 0, characters: 0 };
    byModel.set(key, { ...m, calls: m.calls + 1, tokens: m.tokens + tokens, characters: m.characters + chars });
  }
  const zaiTokens = [...byModel.values()].filter((m) => m.provider === "zai").reduce((n, m) => n + m.tokens, 0);
  return {
    calls: rows.length,
    inputTokens,
    outputTokens,
    characters,
    since: rows[0]?.createdAt.toISOString() ?? null,
    zaiCredits: zaiTokens ? zaiCredits(zaiTokens, tokensPerCredit) : null,
    tokensPerCredit,
    byFeature: [...byFeature.entries()].map(([feature, v]) => ({ feature, ...v })).sort((a, b) => b.tokens + b.characters - (a.tokens + a.characters)),
    byModel: [...byModel.values()]
      .map((m) => ({ ...m, zaiCredits: m.provider === "zai" ? zaiCredits(m.tokens, tokensPerCredit) : null }))
      .sort((a, b) => b.tokens - a.tokens),
  };
}
