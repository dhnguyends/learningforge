/**
 * Canonical user-facing processing phases for a source, derived from the
 * source status plus the latest ingest job's granular `stage` string.
 *
 * The five phases shown in the UI:
 *   uploading → extracting text → chunking → vectorizing → indexing
 *
 * Internal job stages are finer-grained (especially on the A/V path); each
 * maps onto exactly one phase here. Kept out of the component file so it is
 * unit-testable without importing JSX.
 */

export const PIPELINE_PHASES = [
  { key: "uploading", label: "Uploading" },
  { key: "extracting", label: "Extracting text" },
  { key: "chunking", label: "Chunking" },
  { key: "vectorizing", label: "Vectorizing" },
  { key: "indexing", label: "Indexing" },
] as const;

export type PipelinePhase = (typeof PIPELINE_PHASES)[number]["key"];
export type PipelineStep = PipelinePhase | "complete";

/** Granular job stage (GenerationJob.stage) → UI phase. */
const STAGE_TO_PHASE: Record<string, PipelineStep> = {
  // Everything that turns the raw upload into text collapses into "extracting".
  probing: "extracting",
  "fetching-source": "extracting",
  "extracting-audio": "extracting",
  transcribing: "extracting",
  "parsing-document": "extracting",
  segmenting: "chunking",
  vectorizing: "vectorizing",
  indexing: "indexing",
  // French sources are translated after they are READY (searchable already).
  translating: "complete",
  complete: "complete",
};

export interface PipelineJobLike {
  stage?: string | null;
  progress?: number | null;
  status?: string;
  error?: string | null;
}

export interface PipelineState {
  step: PipelineStep;
  failed: boolean;
}

/**
 * Resolve which phase a source is on.
 *
 * - PENDING_UPLOAD → "uploading" (no job exists yet)
 * - READY → "complete"
 * - FAILED → the phase where it died (unknown stage falls back to "extracting")
 * - PROCESSING → mapped stage; an unmapped/missing stage falls back to
 *   "extracting", the first server-side phase after upload
 */
export function pipelineState(status: string, job?: PipelineJobLike | null): PipelineState {
  if (status === "READY") return { step: "complete", failed: false };
  if (status === "PENDING_UPLOAD") return { step: "uploading", failed: false };
  if (status === "FAILED") {
    const mapped = job?.stage ? STAGE_TO_PHASE[job.stage] : undefined;
    return { step: mapped && mapped !== "complete" ? mapped : "extracting", failed: true };
  }
  const mapped = job?.stage ? STAGE_TO_PHASE[job.stage] : undefined;
  return { step: mapped ?? "extracting", failed: false };
}

/** Latest ingest job for a source from a newest-first job list. */
export function ingestJobFor<T extends { sourceId?: string | null; type?: string }>(
  jobs: T[] | undefined,
  sourceId: string,
): T | null {
  return (jobs ?? []).find((j) => j.sourceId === sourceId && (j.type ? j.type === "INGEST_SOURCE" : true)) ?? null;
}
