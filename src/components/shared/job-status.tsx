"use client";

import { Loader2, CheckCircle2, XCircle, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { titleCase } from "@/lib/utils";

export interface JobLike {
  id?: string;
  type: string;
  status: string;
  stage?: string | null;
  progress?: number | null;
  error?: string | null;
}

const STATUS_STYLES: Record<string, string> = {
  QUEUED: "bg-muted text-muted-foreground",
  RUNNING: "bg-primary/15 text-primary",
  SUCCEEDED: "bg-[hsl(var(--success))]/15 text-[hsl(var(--success))]",
  FAILED: "bg-destructive/15 text-destructive",
  CANCELLED: "bg-muted text-muted-foreground",
};

export function JobStatusPill({ job }: { job: JobLike }) {
  const icon =
    job.status === "RUNNING" ? (
      <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
    ) : job.status === "SUCCEEDED" ? (
      <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
    ) : job.status === "FAILED" ? (
      <XCircle className="h-3 w-3" aria-hidden="true" />
    ) : (
      <Clock className="h-3 w-3" aria-hidden="true" />
    );
  return (
    <Badge variant="outline" className={`gap-1 ${STATUS_STYLES[job.status] ?? ""}`}>
      {icon}
      {titleCase(job.status)}
    </Badge>
  );
}

export const STAGE_LABELS: Record<string, string> = {
  probing: "Reading media",
  "fetching-source": "Fetching recording",
  "extracting-audio": "Extracting audio",
  transcribing: "Transcribing",
  "parsing-document": "Parsing document",
  segmenting: "Segmenting content",
  indexing: "Indexing sources",
  "retrieving-sources": "Gathering source chunks",
  "generating-outline": "Drafting outline",
  "generating-sections": "Writing sections",
  "generating-cards": "Writing cards",
  "generating-questions": "Writing questions",
  "generating-exercises": "Designing exercises",
  "writing-script": "Writing recap script",
  "synthesizing-audio": "Synthesizing audio",
  validating: "Validating citations",
  complete: "Complete",
};

/** Live progress row for the processing dashboard. */
export function JobProgressRow({ job }: { job: JobLike }) {
  return (
    <div className="space-y-1.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <JobStatusPill job={job} />
          <span className="text-sm font-medium">{titleCase(job.type.replace(/_/g, " ").toLowerCase())}</span>
          {job.stage && job.status === "RUNNING" && (
            <span className="text-xs text-muted-foreground">{STAGE_LABELS[job.stage] ?? job.stage}…</span>
          )}
        </div>
        {job.error && <span className="truncate text-xs text-destructive">{job.error}</span>}
      </div>
      {job.status === "RUNNING" && <Progress value={job.progress ?? 0} aria-label={`${job.progress ?? 0}% complete`} />}
    </div>
  );
}
