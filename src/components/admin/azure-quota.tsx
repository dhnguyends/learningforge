"use client";

import { AlertTriangle, Languages, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { useSaveTranslatorChoice, useSpeechSettings, type SpeechSettings } from "@/hooks/use-api";

type Quota = SpeechSettings["translator"]["azureQuota"];

const millions = (n: number) => `${(n / 1_000_000).toFixed(2)} M`;

/** "1.62 M of 2.00 M free characters this month (81 %)". */
export function quotaLine(q: Quota): string {
  return `${millions(q.used)} of ${millions(q.limit)} free characters used this month (${q.percent} %)`;
}

/** The switch the administrator confirms: never done by the app itself. */
function SwitchButton({ quota }: { quota: Quota }) {
  const save = useSaveTranslatorChoice();
  return (
    <Button
      size="sm"
      variant={quota.level === "reached" ? "default" : "outline"}
      disabled={save.isPending}
      onClick={async () => {
        try {
          await save.mutateAsync({ provider: "local", model: quota.suggestion.model });
          toast.success(`Translator switched to ${quota.suggestion.label} (local)`);
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Could not switch the translator");
        }
      }}
    >
      {save.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
      Switch to {quota.suggestion.label} (local)
    </Button>
  );
}

/**
 * Azure AI Translator's free tier in the Translator card: the month's use,
 * and from 80 % a warning with the switch to a local model.
 */
export function AzureQuotaMeter({ quota, active }: { quota: Quota; active: boolean }) {
  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <p className="text-xs font-medium">Azure AI Translator free tier</p>
      <Progress
        value={quota.percent}
        aria-label={`Azure free characters ${quota.percent}% used`}
        indicatorClassName={quota.level === "reached" ? "bg-destructive" : quota.level === "near" ? "bg-amber-500" : undefined}
      />
      <p className="text-xs text-muted-foreground">
        {quotaLine(quota)}; resets {new Date(quota.resetsAt).toLocaleDateString()}.
      </p>
      {active && quota.level !== "ok" && <QuotaAdvice quota={quota} />}
    </div>
  );
}

function QuotaAdvice({ quota }: { quota: Quota }) {
  return (
    <div className={cn("space-y-2 rounded-md p-2 text-sm", quota.level === "reached" ? "bg-destructive/10" : "bg-amber-500/10")}>
      <p className="flex gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
        <span>
          {quota.level === "reached"
            ? quota.refusedAt
              ? "Azure refused translations: the free limit is reached. Translations fail until the month ends, unless you switch to a local model."
              : "The free limit is reached: Azure will refuse translations (or bill them on a paid tier) until the month ends."
            : "The free limit is close. Switch to a local model before it is reached, or keep Azure if your plan is paid."}
          {quota.suggestion.note && <span className="mt-1 block text-xs text-muted-foreground">{quota.suggestion.note}</span>}
        </span>
      </p>
      <SwitchButton quota={quota} />
    </div>
  );
}

/** At the top of /admin while Azure is the translator and its free tier is (nearly) used up. */
export function AzureQuotaBanner() {
  const { data } = useSpeechSettings();
  const quota = data?.translator.azureQuota;
  if (!data || !quota || data.translator.active.provider !== "azure" || quota.level === "ok") return null;
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm",
        quota.level === "reached" ? "border-destructive/50 bg-destructive/10" : "border-amber-500/40 bg-amber-500/10",
      )}
    >
      <Languages className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="font-medium">
          {quota.level === "reached" ? "Azure AI Translator: free limit reached." : "Azure AI Translator: free limit close."}
        </span>{" "}
        {quotaLine(quota)}. Switch the translator to {quota.suggestion.label}, a free local model?
        {quota.suggestion.note && <span className="block text-xs text-muted-foreground">{quota.suggestion.note}</span>}
      </span>
      <SwitchButton quota={quota} />
    </div>
  );
}
