"use client";

import { Check, ChevronRight, Loader2, X } from "lucide-react";
import { PIPELINE_PHASES, pipelineState, type PipelineJobLike } from "@/lib/pipeline-phases";
import { cn } from "@/lib/utils";

type StepState = "done" | "current" | "failed" | "pending";

/**
 * Source processing status bar:
 *   uploading → extracting text → chunking → vectorizing → indexing
 *
 * Phase comes from the source status + the latest ingest job's granular
 * stage (see src/lib/pipeline-phases.ts). Show it while a source is
 * PENDING_UPLOAD / PROCESSING / FAILED; READY sources need no bar.
 */
export function PipelineStatusBar({
  status,
  job,
  compact = false,
  className,
}: {
  status: string;
  job?: PipelineJobLike | null;
  compact?: boolean;
  className?: string;
}) {
  const { step, failed } = pipelineState(status, job);
  const currentIdx = step === "complete" ? PIPELINE_PHASES.length : PIPELINE_PHASES.findIndex((p) => p.key === step);
  const progress = !failed && job?.progress != null ? Math.max(0, Math.min(100, job.progress)) : null;

  const label = step === "complete" ? "Complete" : (PIPELINE_PHASES[currentIdx]?.label ?? "Processing");
  const pct = progress != null ? ` — ${Math.round(progress)}%` : "";
  const aria = failed ? `Processing failed at: ${label}` : `Processing: ${label}${pct}`;

  return (
    <div
      role={failed ? "alert" : "status"}
      aria-label={aria}
      className={cn("w-full min-w-0", className)}
      data-phase={step}
      data-failed={failed || undefined}
    >
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-1">
        {PIPELINE_PHASES.map((phase, i) => {
          const state: StepState = failed
            ? i < currentIdx
              ? "done"
              : i === currentIdx
                ? "failed"
                : "pending"
            : i < currentIdx || step === "complete"
              ? "done"
              : i === currentIdx
                ? "current"
                : "pending";
          return (
            <li key={phase.key} className="flex items-center gap-1">
              <StepMarker state={state} compact={compact} />
              <span
                className={cn(
                  "whitespace-nowrap",
                  compact ? "text-[10px]" : "text-xs",
                  state === "current" && "font-medium text-primary",
                  state === "done" && "text-muted-foreground",
                  state === "failed" && "font-medium text-destructive",
                  state === "pending" && "text-muted-foreground/60",
                )}
              >
                {phase.label}
              </span>
              {i < PIPELINE_PHASES.length - 1 && (
                <ChevronRight
                  className={cn("shrink-0 text-muted-foreground/40", compact ? "h-2.5 w-2.5" : "h-3 w-3")}
                  aria-hidden="true"
                />
              )}
            </li>
          );
        })}
      </ol>

      {progress != null && (
        <div
          className={cn("mt-1.5 w-full overflow-hidden rounded-full bg-muted", compact ? "h-0.5" : "h-1")}
          aria-hidden="true"
        >
          <div
            className="h-full rounded-full bg-primary transition-all duration-500"
            style={{ width: `${step === "complete" ? 100 : progress}%` }}
          />
        </div>
      )}

      {failed && job?.error && (
        <p className={cn("mt-1 truncate text-destructive", compact ? "text-[10px]" : "text-xs")} title={job.error}>
          {job.error}
        </p>
      )}
    </div>
  );
}

function StepMarker({ state, compact }: { state: StepState; compact: boolean }) {
  const box = compact ? "h-3 w-3" : "h-3.5 w-3.5";
  switch (state) {
    case "done":
      return (
        <span
          className={cn(
            "flex shrink-0 items-center justify-center rounded-full bg-[hsl(var(--success))]/15 text-[hsl(var(--success))]",
            box,
          )}
        >
          <Check className={compact ? "h-2 w-2" : "h-2.5 w-2.5"} aria-hidden="true" />
        </span>
      );
    case "current":
      return <Loader2 className={cn("shrink-0 animate-spin text-primary", box)} aria-hidden="true" />;
    case "failed":
      return (
        <span className={cn("flex shrink-0 items-center justify-center rounded-full bg-destructive/15 text-destructive", box)}>
          <X className={compact ? "h-2 w-2" : "h-2.5 w-2.5"} aria-hidden="true" />
        </span>
      );
    case "pending":
      return <span className={cn("shrink-0 rounded-full bg-border", compact ? "h-1.5 w-1.5" : "h-2 w-2")} aria-hidden="true" />;
  }
}
