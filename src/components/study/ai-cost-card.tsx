"use client";

import { Coins } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCourseAiCost } from "@/hooks/use-api";

const FEATURE_LABEL: Record<string, string> = {
  guide: "Study guide",
  flashcards: "Flashcards",
  quiz: "Quiz",
  exercises: "Exercises",
  "audio-recap": "Audio recap",
  ingest: "Import",
  tutor: "Tutor",
  "exercise-feedback": "Exercise feedback",
  translation: "Translation",
  other: "Other",
};

const fmt = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)} M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)} k` : String(n));

/**
 * The real AI cost of this course: tokens of every generation (study guide,
 * cards, quiz, exercises, tutor…), characters sent to Azure AI Translator,
 * and the estimated Z.ai credits for calls made with GLM.
 */
export function AiCostCard({ studySetId }: { studySetId: string }) {
  const { data } = useCourseAiCost(studySetId);
  if (!data) return null;
  const tokens = data.inputTokens + data.outputTokens;

  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Coins className="h-4 w-4 text-primary" aria-hidden="true" /> AI cost of this course
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {data.calls === 0 ? (
          <p className="text-muted-foreground">No AI call recorded yet. Generations and tutor answers are counted from now on.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              <p>
                <span className="text-lg font-semibold tabular-nums">{fmt(tokens)}</span> <span className="text-muted-foreground">tokens</span>{" "}
                <span className="text-xs text-muted-foreground">
                  ({fmt(data.inputTokens)} in · {fmt(data.outputTokens)} out, {data.calls} calls)
                </span>
              </p>
              {data.zaiCredits != null && (
                <p title={`Estimate: about ${data.tokensPerCredit.toLocaleString()} tokens per credit (ZAI_TOKENS_PER_CREDIT)`}>
                  <span className="text-lg font-semibold tabular-nums">≈ {data.zaiCredits.toLocaleString()}</span>{" "}
                  <span className="text-muted-foreground">Z.ai credits</span>
                </p>
              )}
              {data.characters > 0 && (
                <p>
                  <span className="text-lg font-semibold tabular-nums">{fmt(data.characters)}</span>{" "}
                  <span className="text-muted-foreground">characters to Azure Translator</span>
                </p>
              )}
            </div>
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1 font-medium">For</th>
                  <th className="py-1 text-right font-medium">Calls</th>
                  <th className="py-1 text-right font-medium">Tokens</th>
                  <th className="py-1 text-right font-medium">Characters</th>
                </tr>
              </thead>
              <tbody>
                {data.byFeature.map((f) => (
                  <tr key={f.feature} className="border-t border-border/60">
                    <td className="py-1">{FEATURE_LABEL[f.feature] ?? f.feature}</td>
                    <td className="py-1 text-right tabular-nums">{f.calls}</td>
                    <td className="py-1 text-right tabular-nums">{f.tokens ? fmt(f.tokens) : "–"}</td>
                    <td className="py-1 text-right tabular-nums">{f.characters ? fmt(f.characters) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-muted-foreground">
              Models: {data.byModel.map((m) => `${m.model} (${m.provider})`).join(", ")}
              {data.since ? ` · since ${new Date(data.since).toLocaleDateString()}` : ""}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
