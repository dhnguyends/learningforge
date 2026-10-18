import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { getActiveAi } from "@/lib/ai/settings";
import { localModelLabel, sameModel } from "@/lib/ai/ollama";

/**
 * Azure AI Translator's free tier: characters used this calendar month (from
 * the AI usage records) against AZURE_TRANSLATOR_FREE_CHARS, and a quota
 * refusal noted from Azure itself. At 80 % Admin warns; at the limit it asks
 * the administrator to switch the translator to a local model — never by
 * itself.
 */

const NOTE_KEY = "translator_quota";

/** Azure's answer when the free quota is used up (403001) or throttled for quota. */
export function isQuotaRefusal(status: number, message: string): boolean {
  return (status === 403 || status === 429) && /quota|403001|exceeded/i.test(message);
}

export async function noteAzureQuotaRefusal(message: string): Promise<void> {
  const value = { refusedAt: new Date().toISOString(), message: message.slice(0, 300) };
  await prisma.appSetting
    .upsert({ where: { key: NOTE_KEY }, create: { key: NOTE_KEY, value }, update: { value } })
    .catch(() => undefined);
}

const monthStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
const nextMonthStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));

export interface AzureQuotaStatus {
  /** Characters sent to Azure AI Translator this month (UTC). */
  used: number;
  limit: number;
  percent: number;
  /** "ok" < 80 %, "near" from 80 %, "reached" at the limit or after a quota refusal this month. */
  level: "ok" | "near" | "reached";
  refusedAt: string | null;
  resetsAt: string;
  /** The local model to switch to, and why another one when the rule requires it. */
  suggestion: { model: string; label: string; note: string | null };
}

/** Pure: the level for a month's use. */
export function quotaLevel(used: number, limit: number, refusedThisMonth: boolean): AzureQuotaStatus["level"] {
  if (refusedThisMonth || used >= limit) return "reached";
  return used >= limit * 0.8 ? "near" : "ok";
}

export async function azureTranslatorQuota(now: Date = new Date()): Promise<AzureQuotaStatus> {
  const env = getEnv();
  const from = monthStart(now);
  const [sum, note, ai] = await Promise.all([
    prisma.aiUsage.aggregate({ where: { provider: "azure-translator", createdAt: { gte: from } }, _sum: { characters: true } }),
    prisma.appSetting.findUnique({ where: { key: NOTE_KEY } }),
    getActiveAi(),
  ]);
  const used = sum._sum.characters ?? 0;
  const limit = env.AZURE_TRANSLATOR_FREE_CHARS;
  const refusedAt = (note?.value as { refusedAt?: string } | null)?.refusedAt ?? null;
  const refusedThisMonth = Boolean(refusedAt && new Date(refusedAt) >= from);

  // One local model on the GPU: while the AI model is another local model, the
  // translator can only use that one.
  const wanted = env.AZURE_TRANSLATOR_FALLBACK_MODEL;
  const aiLocal = ai.provider === "local" ? ai.model : null;
  const model = aiLocal && !sameModel(aiLocal, wanted) ? aiLocal : wanted;
  const note_ =
    model === wanted
      ? null
      : `${localModelLabel(wanted)} cannot translate while the AI model is ${localModelLabel(aiLocal!)} (one local model on the GPU): the translator would use ${localModelLabel(aiLocal!)}.`;

  return {
    used,
    limit,
    percent: Math.min(100, Math.round((used / limit) * 1000) / 10),
    level: quotaLevel(used, limit, refusedThisMonth),
    refusedAt: refusedThisMonth ? refusedAt : null,
    resetsAt: nextMonthStart(now).toISOString(),
    suggestion: { model, label: localModelLabel(model), note: note_ },
  };
}
