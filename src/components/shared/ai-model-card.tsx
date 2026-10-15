"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Cloud, Cpu, Loader2, PlugZap, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  useAdminAiSettings,
  useSaveAiChoice,
  useTestAiChoice,
  type AiChoiceInput,
  type AiTestResult,
} from "@/hooks/use-api";

type Option = { value: string; choice: AiChoiceInput; label: string; note: string; cloud: boolean; disabled: boolean };

const optionValue = (c: AiChoiceInput) => (c.provider === "gemini" ? `gemini:${c.model}` : "local");

/**
 * Administrator choice of the generation model (study guides, flashcards,
 * quizzes, exercises, tutor). Embeddings are not affected. Choosing Gemini
 * sends prompts — including source excerpts — to Google, so the card says so
 * whenever a cloud model is selected or active.
 */
export function AiModelCard() {
  const { data, isLoading, error } = useAdminAiSettings();
  const save = useSaveAiChoice();
  const test = useTestAiChoice();
  const [selected, setSelected] = useState<string | null>(null);
  const [result, setResult] = useState<AiTestResult | null>(null);

  if (isLoading) return <div className="h-48 animate-pulse rounded-lg bg-muted" />;
  if (error || !data) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-destructive">{error?.message ?? "Could not load AI settings"}</CardContent>
      </Card>
    );
  }

  const activeValue =
    data.active.provider === "gemini" ? `gemini:${data.active.model}` : data.active.provider === "local" ? "local" : null;
  const options: Option[] = [
    {
      value: "local",
      choice: { provider: "local" },
      label: `Gemma 4 — local (${data.localModel})`,
      note: "Runs on this computer through Ollama. Private, works offline, no cost; slower on long outputs.",
      cloud: false,
      disabled: data.mockMode,
    },
    ...data.geminiModels.map((m) => ({
      value: `gemini:${m.id}`,
      choice: { provider: "gemini" as const, model: m.id },
      label: `${m.label} — Google cloud`,
      note: m.note,
      cloud: true,
      disabled: data.mockMode || !data.geminiConfigured,
    })),
  ];
  const current = selected ?? activeValue ?? (data.stored ? optionValue(data.stored) : "local");
  const chosen = options.find((o) => o.value === current) ?? options[0];
  const dirty = chosen.value !== activeValue;
  const cloudInUse = data.active.provider === "gemini" || chosen.cloud;

  async function onTest() {
    setResult(null);
    try {
      setResult(await test.mutateAsync(chosen.choice));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Test failed");
    }
  }

  async function onSave() {
    try {
      await save.mutateAsync(chosen.choice);
      setSelected(null);
      setResult(null);
      toast.success(`AI model set to ${chosen.label}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Cpu className="h-4 w-4 text-primary" aria-hidden="true" /> AI model
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Used for study guides, flashcards, quizzes, exercises, feedback and the tutor. Search embeddings are not affected.
            {" "}Now using <span className="font-medium text-foreground">{data.active.model}</span>
            {data.active.source === "env" && " (server default)"}.
          </p>
        </div>

        {data.mockMode && (
          <p className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
            The server runs in offline demo mode (AI_PROVIDER=mock), so the model cannot be changed here.
          </p>
        )}
        {data.active.source === "fallback" && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            Gemini needs GEMINI_API_KEY in the server .env; until it is set, the local model is used.
          </p>
        )}

        <fieldset className="space-y-2" disabled={data.mockMode}>
          <legend className="sr-only">Generation model</legend>
          {options.map((o) => (
            <label
              key={o.value}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors",
                o.value === current ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40",
                o.disabled && "cursor-not-allowed opacity-60",
              )}
            >
              <input
                type="radio"
                name="ai-model"
                value={o.value}
                checked={o.value === current}
                disabled={o.disabled}
                onChange={() => {
                  setSelected(o.value);
                  setResult(null);
                }}
                className="mt-1 accent-[hsl(var(--primary))]"
              />
              <span className="flex-1">
                <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {o.cloud ? <Cloud className="h-3.5 w-3.5" aria-hidden="true" /> : <Cpu className="h-3.5 w-3.5" aria-hidden="true" />}
                  {o.label}
                  {o.value === activeValue && <Badge className="text-[10px]">In use</Badge>}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {o.cloud && !data.geminiConfigured ? "Set GEMINI_API_KEY in the server .env to enable." : o.note}
                </span>
              </span>
            </label>
          ))}
        </fieldset>

        {cloudInUse && (
          <p className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
            <span>
              With Gemini, prompts — including excerpts of your uploaded sources — are sent to Google. On a free-tier API key,
              Google may use them to improve its products; use a paid project for private material.
            </span>
          </p>
        )}

        {result && (
          <p
            role="status"
            className={cn("flex items-start gap-2 text-sm", result.ok ? "text-emerald-700 dark:text-emerald-400" : "text-destructive")}
          >
            {result.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
            <span>
              {result.ok ? `${result.model} answered in ${(result.latencyMs / 1000).toFixed(1)} s.` : `${result.model}: ${result.error}`}
            </span>
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onTest} disabled={data.mockMode || chosen.disabled || test.isPending}>
            {test.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <PlugZap className="mr-1.5 h-4 w-4" aria-hidden="true" />}
            Test connection
          </Button>
          <Button onClick={onSave} disabled={data.mockMode || chosen.disabled || !dirty || save.isPending}>
            {save.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
            Use this model
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
