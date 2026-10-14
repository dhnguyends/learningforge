import { describe, it, expect } from "vitest";
import { PIPELINE_PHASES, pipelineState, ingestJobFor } from "@/lib/pipeline-phases";

describe("pipelineState", () => {
  it("maps the five phases in pipeline order", () => {
    expect(PIPELINE_PHASES.map((p) => p.key)).toEqual(["uploading", "extracting", "chunking", "vectorizing", "indexing"]);
  });

  it("PENDING_UPLOAD is the uploading phase (no job exists yet)", () => {
    expect(pipelineState("PENDING_UPLOAD")).toEqual({ step: "uploading", failed: false });
    expect(pipelineState("PENDING_UPLOAD", null)).toEqual({ step: "uploading", failed: false });
  });

  it("READY is complete", () => {
    expect(pipelineState("READY")).toEqual({ step: "complete", failed: false });
    expect(pipelineState("READY", { stage: "indexing" })).toEqual({ step: "complete", failed: false });
  });

  it("maps every granular job stage to its UI phase", () => {
    const cases: [string, ReturnType<typeof pipelineState>["step"]][] = [
      ["probing", "extracting"],
      ["fetching-source", "extracting"],
      ["extracting-audio", "extracting"],
      ["transcribing", "extracting"],
      ["parsing-document", "extracting"],
      ["segmenting", "chunking"],
      ["vectorizing", "vectorizing"],
      ["indexing", "indexing"],
      ["complete", "complete"],
    ];
    for (const [stage, step] of cases) {
      expect(pipelineState("PROCESSING", { stage })).toEqual({ step, failed: false });
    }
  });

  it("PROCESSING with an unknown or missing stage falls back to extracting", () => {
    expect(pipelineState("PROCESSING")).toEqual({ step: "extracting", failed: false });
    expect(pipelineState("PROCESSING", { stage: "some-future-stage" })).toEqual({ step: "extracting", failed: false });
    expect(pipelineState("PROCESSING", { stage: null })).toEqual({ step: "extracting", failed: false });
  });

  it("FAILED marks the phase where the job died", () => {
    expect(pipelineState("FAILED", { stage: "transcribing", error: "boom" })).toEqual({ step: "extracting", failed: true });
    expect(pipelineState("FAILED", { stage: "vectorizing", error: "boom" })).toEqual({ step: "vectorizing", failed: true });
    // Stage unknown → first server-side phase.
    expect(pipelineState("FAILED")).toEqual({ step: "extracting", failed: true });
    // Completed stage but source failed afterwards → extracting, never "complete".
    expect(pipelineState("FAILED", { stage: "complete" })).toEqual({ step: "extracting", failed: true });
  });
});

describe("ingestJobFor", () => {
  const jobs = [
    { id: "j3", sourceId: "s1", type: "INGEST_SOURCE" },
    { id: "j2", sourceId: "s1", type: "GENERATE_GUIDE" },
    { id: "j1", sourceId: "s2", type: "INGEST_SOURCE" },
  ];

  it("picks the newest-first ingest job for the source (newest first = detail API order)", () => {
    expect(ingestJobFor(jobs, "s1")?.id).toBe("j3");
    expect(ingestJobFor(jobs, "s2")?.id).toBe("j1");
  });

  it("ignores non-ingest jobs and returns null when there is none", () => {
    expect(ingestJobFor([{ id: "g", sourceId: "s9", type: "GENERATE_GUIDE" }], "s9")).toBeNull();
    expect(ingestJobFor(jobs, "s404")).toBeNull();
    expect(ingestJobFor(undefined, "s1")).toBeNull();
  });
});
