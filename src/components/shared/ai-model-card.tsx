"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Cloud, Cpu, Eraser, Loader2, MemoryStick, PlugZap, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { clearSummary, freedSummary, gb, gbMiB, switchSummary } from "@/components/shared/gpu-report";
import { cn } from "@/lib/utils";
import {
  useAdminAiSettings,
  useAdminGpu,
  useFreeGpu,
  useSaveAiChoice,
  useTestAiChoice,
  type AdminAiSettings,
  type AiChoiceInput,
  type AiTestResult,
  type GpuClearReport,
  type LocalSwitchReport,
} from "@/hooks/use-api";

type Option = {
  value: string;
  choice: AiChoiceInput;
  label: string;
  note: string;
  /** Cloud provider name for the privacy warning; null = runs locally. */
  cloud: string | null;
  disabled: boolean;
  /** Shown instead of the note when the provider's key is missing. */
  missingKey?: string;
};

/** "gemma4" and "gemma4:latest" are the same Ollama model. */
const norm = (m: string) => (m.includes(":") ? m : `${m}:latest`).toLowerCase();
const localValue = (model: string) => `local:${norm(model)}`;
const optionValue = (c: AiChoiceInput, defaultLocal: string) =>
  c.provider === "gemini" ? `gemini:${c.model}` : c.provider === "local" ? localValue(c.model ?? defaultLocal) : c.provider;

function localNote(m: AdminAiSettings["localModels"][number]): string {
  const size = m.sizeBytes ? ` ${gb(m.sizeBytes)} on disk.` : "";
  if (/deepseek-r1/i.test(m.name)) {
    return `Reasoning model${m.parameterSize ? ` (${m.parameterSize})` : ""}: thinks before answering, stronger on hard questions but slower. Runs on this computer through Ollama.${size}`;
  }
  if (/gemma-?4/i.test(m.name)) return `Runs on this computer through Ollama. Private, works offline, no cost; slower on long outputs.${size}`;
  return `Runs on this computer through Ollama${m.parameterSize ? ` (${m.parameterSize} parameters)` : ""}. Private, works offline, no cost.${size}`;
}

/**
 * Administrator choice of the generation model (study guides, flashcards,
 * quizzes, exercises, tutor). Embeddings are not affected. Choosing a cloud
 * model (Gemini, GLM on Z.ai) sends prompts — including source
 * excerpts — to that provider, so the card says so whenever one is selected
 * or active.
 */
export function AiModelCard() {
  const { data, isLoading, error } = useAdminAiSettings();
  const save = useSaveAiChoice();
  const test = useTestAiChoice();
  const [selected, setSelected] = useState<string | null>(null);
  const [result, setResult] = useState<AiTestResult | null>(null);
  const [gpuReport, setGpuReport] = useState<{ text: string; warn: boolean } | null>(null);

  if (isLoading) return <div className="h-48 animate-pulse rounded-lg bg-muted" />;
  if (error || !data) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-destructive">{error?.message ?? "Could not load AI settings"}</CardContent>
      </Card>
    );
  }

  const activeValue =
    data.active.provider === "gemini"
      ? `gemini:${data.active.model}`
      : data.active.provider === "local"
        ? localValue(data.active.model)
        : data.active.provider === "zai"
          ? "zai"
          : null;
  const localModels = data.localModels.length
    ? data.localModels
    : [{ name: data.localModel, label: data.localModel, parameterSize: null, sizeBytes: 0, thinking: false, installed: false }];
  const options: Option[] = [
    // One option per model installed in Ollama (Gemma 4, DeepSeek-R1...).
    ...localModels.map((m) => ({
      value: localValue(m.name),
      choice: { provider: "local" as const, model: m.name },
      label: m.label === m.name ? `${m.name} \u2014 local` : `${m.label} \u2014 local (${m.name})`,
      note: localNote(m),
      cloud: null,
      disabled: data.mockMode || !m.installed,
      missingKey: m.installed || data.mockMode ? undefined : "Ollama is not reachable: start it to list and use the installed models.",
    })),
    ...data.geminiModels.map((m) => ({
      value: `gemini:${m.id}`,
      choice: { provider: "gemini" as const, model: m.id },
      label: `${m.label} — Google cloud`,
      note: m.note,
      cloud: "Google",
      disabled: data.mockMode || !data.geminiConfigured,
      missingKey: data.geminiConfigured ? undefined : "Set GEMINI_API_KEY in the server .env to enable.",
    })),
    {
      value: "zai",
      choice: { provider: "zai" },
      label: `${data.zai.label} — Z.ai cloud`,
      note: `GLM served directly by Z.ai, its developer (${data.zai.model}).`,
      cloud: "Z.ai",
      disabled: data.mockMode || !data.zai.configured,
      missingKey: data.zai.configured ? undefined : "Set ZAI_API_KEY in the server .env to enable.",
    },
  ];
  const current = selected ?? activeValue ?? (data.stored ? optionValue(data.stored, data.localModel) : localValue(data.localModel));
  const chosen = options.find((o) => o.value === current) ?? options[0];
  const dirty = chosen.value !== activeValue;
  const activeOption = options.find((o) => o.value === activeValue);
  const cloudProvider = chosen.cloud ?? activeOption?.cloud ?? null;

  async function onTest() {
    setResult(null);
    try {
      setResult(await test.mutateAsync(chosen.choice));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Test failed");
    }
  }

  async function onSave() {
    setGpuReport(null);
    try {
      const saved = await save.mutateAsync(chosen.choice);
      setSelected(null);
      setResult(null);
      const followed = saved.translatorFollowed
        ? ` The translator now uses ${saved.translatorFollowed.to} too (it used ${saved.translatorFollowed.from}): one model on the GPU.`
        : "";
      if (saved.gpu) setGpuReport({ text: switchSummary(saved.gpu) + followed, warn: saved.gpu.stillLoaded.length > 0 || !saved.gpu.loaded });
      // A cloud model: the local language models nothing uses any more were unloaded.
      if (saved.gpuFreed) setGpuReport({ text: freedSummary(saved.gpuFreed), warn: saved.gpuFreed.stillLoaded.length > 0 });
      const report = saved.gpu ? switchSummary(saved.gpu) + followed : saved.gpuFreed ? freedSummary(saved.gpuFreed) : undefined;
      toast.success(`AI model set to ${chosen.label}`, report ? { description: report } : undefined);
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
            The selected cloud model has no key in the server .env (GEMINI_API_KEY or ZAI_API_KEY); until it is set, the local model is used.
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
                  {o.missingKey ?? o.note}
                </span>
              </span>
            </label>
          ))}
        </fieldset>

        {!data.mockMode && <GpuMemoryPanel report={gpuReport} onReport={setGpuReport} />}

        {cloudProvider && (
          <p className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
            <span>
              With a cloud model, prompts — including excerpts of your uploaded sources — are sent to {cloudProvider}. On
              free tiers they may be used to improve the provider&apos;s products; use a paid plan for private material.
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
            {save.isPending && chosen.choice.provider === "local" ? "Freeing GPU memory and loading\u2026" : "Use this model"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * GPU memory: what Ollama has loaded now and the card's use. Choosing a local
 * model unloads the others first; "Free GPU memory" unloads everything (the
 * next job loads what it needs).
 */
function GpuMemoryPanel({
  report,
  onReport,
}: {
  report: { text: string; warn: boolean } | null;
  onReport: (r: { text: string; warn: boolean } | null) => void;
}) {
  const { data } = useAdminGpu();
  const free = useFreeGpu();
  if (!data) return null;
  const pct = data.usedMiB != null && data.totalMiB ? Math.round((data.usedMiB / data.totalMiB) * 100) : null;

  async function onFree() {
    onReport(null);
    try {
      const r = await free.mutateAsync();
      onReport({ text: clearSummary(r), warn: r.stillLoaded.length > 0 });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not free GPU memory");
    }
  }

  return (
    <section aria-label="GPU memory" className="space-y-2 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <MemoryStick className="h-4 w-4 text-primary" aria-hidden="true" /> GPU memory
        </h3>
        <Button size="sm" variant="outline" onClick={onFree} disabled={free.isPending || !data.ollamaReachable || !data.loaded.length}>
          {free.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Eraser className="mr-1.5 h-4 w-4" aria-hidden="true" />}
          Free GPU memory
        </Button>
      </div>
      {pct != null && data.usedMiB != null && data.totalMiB != null && (
        <div className="space-y-1">
          <Progress value={pct} aria-label={`GPU memory ${pct}% used`} indicatorClassName={pct > 90 ? "bg-amber-500" : undefined} />
          <p className="text-xs text-muted-foreground">
            {gbMiB(data.usedMiB)} of {gbMiB(data.totalMiB)} used (all programs, including speech recognition).
          </p>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {!data.ollamaReachable
          ? "Ollama is not reachable."
          : data.loaded.length
            ? `In Ollama now: ${data.loaded.map((m) => m.name).join(", ")}.`
            : "No Ollama model in memory: the next job loads its model."}{" "}
        Choosing a local model unloads the others first, so only one runs on the GPU.
      </p>
      {report && (
        <p role="status" className={cn("text-xs", report.warn ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400")}>
          {report.text}
        </p>
      )}
    </section>
  );
}
