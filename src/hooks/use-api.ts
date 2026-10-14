"use client";

/**
 * React Query data layer for LearningForge.
 *
 * API conventions (src/lib/api.ts): success bodies ARE the payload (`ok(data)`),
 * errors are `{ error, code }` with a meaningful HTTP status.
 */

import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient, type UseMutationOptions } from "@tanstack/react-query";

export class ApiClientError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code = "error") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    let code = "error";
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
      if (body?.code) code = body.code;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiClientError(res.status, message, code);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Upload a File/Blob to a presigned ticket URL (PUT), reporting progress 0–1. */
export function uploadToTicket(
  ticket: { uploadUrl: string; headers?: Record<string, string> },
  file: File | Blob,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", ticket.uploadUrl);
    const headers = ticket.headers ?? { "Content-Type": (file as File).type || "application/octet-stream" };
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new ApiClientError(xhr.status, `Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new ApiClientError(0, "Network error during upload"));
    xhr.send(file);
  });
}

/* ---------------------------------- types --------------------------------- */
/* Pragmatic shapes of the API payloads (dates arrive as ISO strings). */

export interface JobRow {
  id?: string;
  studySetId?: string;
  sourceId?: string | null;
  type: string;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  stage?: string | null;
  progress?: number | null;
  error?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface StudySetSummary {
  id: string;
  title: string;
  course: string | null;
  subject: string | null;
  learnerLevel: string;
  examDate: string | null;
  outputTypes: string[];
  createdAt: string;
  updatedAt: string;
  counts: { sources: number; decks: number; quizzes: number; exerciseSets: number; sourcesReady: number; sourcesProcessing: number };
  dueCards: number;
  activeJobs: JobRow[];
}

export interface SourceRow {
  id: string;
  studySetId: string;
  type: string;
  title: string;
  description: string | null;
  status: string;
  error: string | null;
  externalUrl: string | null;
  durationSec: number | null;
  language: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  hasAudioAsset?: boolean;
}

export interface AnchorRef {
  id: string;
  sourceId: string;
  excerpt: string;
  startMs: number | null;
  endMs: number | null;
  page: number | null;
  source?: { id: string; title: string; type: string };
}

export interface GuideSectionRow {
  id: string;
  guideId: string;
  parentIndex: number | null;
  ordinal: number;
  kind: string;
  title: string;
  content: string;
  claimType: string;
  confidence: number | null;
  learningObjective: string | null;
  warnings: string[];
  version: number;
  anchors: AnchorRef[];
}

export interface GuideRow {
  id: string;
  studySetId: string;
  title: string;
  style: string;
  status: string;
  metadata: Record<string, unknown> | null;
  sections: GuideSectionRow[];
}

export interface DeckSummary {
  id: string;
  name: string;
  algorithm: string;
  total: number;
  due: number;
  suspended: number;
  byType?: Record<string, number>;
}

export interface FlashcardRow {
  id: string;
  deckId: string;
  type: string;
  front: string;
  back: string;
  state: string;
  dueAt: string;
  reps: number;
  lapses: number;
  suspended: boolean;
  stability: number | null;
  difficulty: number | null;
  lastReviewedAt: string | null;
  anchors: AnchorRef[];
}

export interface QuizRow {
  id: string;
  title: string;
  status: string;
  config: Record<string, unknown> | null;
  createdAt?: string;
  questions:
    | ({
        id: string;
        ordinal: number;
        type: string;
        stem: string;
        options: { id: string; text: string }[] | null;
        matchValues?: string[] | null;
        learningObjective: string | null;
        difficulty: string;
        warnings: string[];
        anchors: AnchorRef[];
      } & Record<string, unknown>)[]
    | null;
}

export interface ExerciseRow {
  id: string;
  ordinal: number;
  type: string;
  title: string;
  prompt: string;
  prerequisites: string[];
  assumptions: string[];
  requiredKnowledge: string[];
  expectedOutput: string | null;
  estimatedMinutes: number | null;
  difficulty: string;
  grounded: boolean;
  hints: string[];
  warnings: string[];
  anchors: AnchorRef[];
  hasSolution: boolean;
}

export interface ExerciseSetRow {
  id: string;
  title: string;
  status: string;
  config: Record<string, unknown> | null;
  exercises: ExerciseRow[];
}

export interface TutorMessageRow {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  mode: string | null;
  claimType?: string | null;
  hintsUsed: number;
  anchors: AnchorRef[];
  createdAt: string;
}

export interface TutorConversationRow {
  id: string;
  studySetId: string;
  title: string;
  createdAt: string;
  messages?: TutorMessageRow[];
}

export interface AnalyticsPayload {
  topics: { topic: string; mastery: number; attempts: number; trend: string }[];
  flashcards: { total: number; scheduled: number; due: number; meanRetention: number | null; mature: number };
  accuracy: {
    byObjective: { objective: string; accuracy: number; attempts: number }[];
    byDifficulty: { difficulty: string; accuracy: number; attempts: number }[];
  };
  timeStudied: { totalMinutes: number; byDay: { day: string; minutes: number }[] };
  recommendations: { kind: string; message: string; action?: { label: string; href: string } }[];
}

export interface StudySetDetail {
  studySet: StudySetSummary & { settings: Record<string, unknown> };
  sources: SourceRow[];
  guides: GuideRow[];
  decks: DeckSummary[];
  quizzes: QuizRow[];
  exerciseSets: { id: string; title: string; status: string }[];
  jobs: JobRow[];
  conversations: { id: string; title: string; createdAt: string }[];
}

/* ---------------------------------- keys ---------------------------------- */

export const qk = {
  studySets: ["study-sets"] as const,
  studySet: (id: string) => ["study-set", id] as const,
  source: (setId: string, sourceId: string) => ["source", setId, sourceId] as const,
  jobs: (setId?: string) => ["jobs", setId ?? "all"] as const,
  guide: (setId: string) => ["guide", setId] as const,
  decks: (setId: string) => ["decks", setId] as const,
  deck: (deckId: string, due = false) => ["deck", deckId, { due }] as const,
  quizzes: (setId: string) => ["quizzes", setId] as const,
  quiz: (quizId: string) => ["quiz", quizId] as const,
  exerciseSets: (setId: string) => ["exercise-sets", setId] as const,
  exerciseSet: (setId: string) => ["exercise-set", setId] as const,
  tutor: (setId: string) => ["tutor", setId] as const,
  tutorMessages: (convId: string) => ["tutor-messages", convId] as const,
  analytics: (setId: string) => ["analytics", setId] as const,
};

/* -------------------------------- queries --------------------------------- */

const ACTIVE = (jobs: JobRow[] | undefined) =>
  Array.isArray(jobs) && jobs.some((j) => j.status === "QUEUED" || j.status === "RUNNING") ? 2000 : false;

export function useStudySets() {
  return useQuery({ queryKey: qk.studySets, queryFn: () => api<StudySetSummary[]>("/api/study-sets") });
}

export function useStudySet(id: string) {
  return useQuery({
    queryKey: qk.studySet(id),
    queryFn: () => api<StudySetDetail>(`/api/study-sets/${id}`),
    // Poll while jobs run, but also while a source is uploading — no job row
    // exists yet at that point, so ACTIVE(jobs) alone would stop polling
    // exactly when the processing status bar needs to start moving.
    refetchInterval: (q) => {
      const d = q.state.data;
      const sourceActive = (d?.sources ?? []).some((s) => s.status === "PROCESSING" || s.status === "PENDING_UPLOAD");
      return ACTIVE(d?.jobs) || sourceActive ? 2000 : false;
    },
  });
}

export function useJobs(studySetId?: string, poll = true) {
  return useQuery({
    queryKey: qk.jobs(studySetId),
    queryFn: () => api<{ jobs: JobRow[] }>(`/api/jobs${studySetId ? `?studySetId=${encodeURIComponent(studySetId)}` : ""}`),
    refetchInterval: poll ? (q) => ACTIVE(q.state.data?.jobs) : false,
  });
}

export interface TranscriptSegmentRow {
  id: string;
  transcriptId: string;
  idx: number;
  speaker: string | null;
  startMs: number;
  endMs: number;
  text: string;
  edited: boolean;
  flagged: boolean;
  note: string | null;
}

export interface SourceDetail {
  source: SourceRow & {
    playbackUrl: string | null;
    playbackKind: "video" | "audio" | "youtube" | "document";
    assetUrls: Record<string, string>;
    transcripts: { id: string; language: string | null; segments: TranscriptSegmentRow[] }[];
  };
}

export function useSource(studySetId: string, sourceId: string) {
  return useQuery({
    queryKey: qk.source(studySetId, sourceId),
    queryFn: () => api<SourceDetail>(`/api/study-sets/${studySetId}/sources/${sourceId}`),
    // Without an id the URL ends in ".../sources/", which is the LIST route —
    // its { sources } payload has no `source` and crashed the transcript page
    // for study sets with no audio/video source.
    enabled: Boolean(studySetId && sourceId),
    refetchInterval: (q) => (q.state.data?.source.status === "PROCESSING" || q.state.data?.source.status === "PENDING_UPLOAD" ? 2000 : false),
  });
}

export function useGuide(studySetId: string) {
  return useQuery({
    queryKey: qk.guide(studySetId),
    queryFn: () => api<{ guide: GuideRow | null }>(`/api/study-sets/${studySetId}/guide`),
    refetchInterval: (q) => (q.state.data?.guide?.status === "GENERATING" ? 2000 : false),
  });
}

export function useDecks(studySetId: string) {
  return useQuery({ queryKey: qk.decks(studySetId), queryFn: () => api<{ decks: DeckSummary[] }>(`/api/study-sets/${studySetId}/flashcards`) });
}

export function useDeck(deckId: string, due = false) {
  return useQuery({
    queryKey: qk.deck(deckId, due),
    queryFn: () => api<{ deck: { id: string; name: string; algorithm: string; studySetId: string }; cards: FlashcardRow[] }>(
      `/api/decks/${deckId}${due ? "?due=true" : ""}`,
    ),
  });
}

export function useQuizzes(studySetId: string) {
  return useQuery({ queryKey: qk.quizzes(studySetId), queryFn: () => api<{ quizzes: QuizRow[] }>(`/api/study-sets/${studySetId}/quiz`) });
}

export function useQuiz(quizId: string) {
  return useQuery({ queryKey: qk.quiz(quizId), queryFn: () => api<{ quiz: QuizRow }>(`/api/quizzes/${quizId}`) });
}

export function useExerciseSets(studySetId: string) {
  return useQuery({
    queryKey: qk.exerciseSets(studySetId),
    queryFn: () => api<{ exerciseSets: { id: string; title: string; status: string }[] }>(`/api/study-sets/${studySetId}/exercises`),
  });
}

export function useExerciseSet(exerciseSetId: string) {
  return useQuery({
    queryKey: qk.exerciseSet(exerciseSetId),
    queryFn: () => api<{ exerciseSet: ExerciseSetRow }>(`/api/exercise-sets/${exerciseSetId}`),
  });
}

export function useTutorConversations(studySetId: string) {
  return useQuery({
    queryKey: qk.tutor(studySetId),
    queryFn: () => api<{ conversations: TutorConversationRow[] }>(`/api/study-sets/${studySetId}/tutor`),
  });
}

export function useTutorMessages(conversationId: string) {
  return useQuery({
    queryKey: qk.tutorMessages(conversationId),
    queryFn: () => api<{ conversation: TutorConversationRow }>(`/api/tutor/${conversationId}/messages`),
  });
}

export function useAnalytics(studySetId: string) {
  return useQuery({ queryKey: qk.analytics(studySetId), queryFn: () => api<AnalyticsPayload>(`/api/study-sets/${studySetId}/analytics`) });
}

/* -------------------------- mutations (write ops) ------------------------- */

/** Mutation helper: bind invalidations + toast-able ApiClientError propagation. */
function useLfMutation<TVars, TData>(
  fn: (vars: TVars) => Promise<TData>,
  invalidate: (vars: TVars, data: TData) => readonly (readonly unknown[])[],
  opts?: Omit<UseMutationOptions<TData, ApiClientError, TVars, unknown>, "mutationFn">,
) {
  const qc = useQueryClient();
  return useMutation<TData, ApiClientError, TVars>({
    ...opts,
    mutationFn: fn,
    onSuccess: (data, vars, ctx, mutation) => {
      for (const key of invalidate(vars, data)) void qc.invalidateQueries({ queryKey: key });
      opts?.onSuccess?.(data, vars, ctx, mutation);
    },
  });
}

export function useCreateStudySet() {
  return useLfMutation(
    (body: unknown) => api<{ studySet: { id: string }; sources: { source: SourceRow; upload?: { uploadUrl: string; headers?: Record<string, string>; key: string } }[] }>(
      "/api/study-sets",
      { method: "POST", body: JSON.stringify(body) },
    ),
    () => [qk.studySets],
  );
}

export function usePatchStudySet(id: string) {
  return useLfMutation(
    (body: unknown) => api<{ studySet: unknown }>(`/api/study-sets/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    () => [qk.studySets, qk.studySet(id)],
  );
}

export function useDeleteStudySet() {
  const qc = useQueryClient();
  return useLfMutation(
    (id: string) => api<{ deleted: boolean }>(`/api/study-sets/${id}`, { method: "DELETE" }),
    (id) => [qk.studySets, qk.studySet(id)],
    {
      onSuccess: (_d, id) => {
        void qc.removeQueries({ queryKey: qk.studySet(id) });
      },
    },
  );
}

/** Step 1 of adding a file source: create it + get the upload ticket. */
export function useAddFileSource(studySetId: string) {
  return useLfMutation(
    (body: { filename: string; mimeType: string; sizeBytes: number; title?: string; consent?: boolean }) =>
      api<{ source: SourceRow; upload: { uploadUrl: string; headers?: Record<string, string>; key: string } }>(
        `/api/study-sets/${studySetId}/sources`,
        { method: "POST", body: JSON.stringify({ kind: "file", ...body }) },
      ),
    () => [qk.studySet(studySetId), qk.studySets],
  );
}

export function useAddYouTubeSource(studySetId: string) {
  return useLfMutation(
    (body: { url: string; title?: string; consent: boolean }) =>
      api<{ source: SourceRow; jobId: string }>(`/api/study-sets/${studySetId}/sources`, {
        method: "POST",
        body: JSON.stringify({ kind: "youtube", ...body }),
      }),
    () => [qk.studySet(studySetId), qk.studySets, qk.jobs(studySetId)],
  );
}

/** Step 3: mark upload complete → server verifies object + starts ingest. */
export function useCompleteUpload(studySetId: string) {
  return useLfMutation(
    (body: { sourceId: string; key?: string }) =>
      api<{ jobId: string }>(`/api/uploads/complete`, { method: "POST", body: JSON.stringify({ sourceId: body.sourceId }) }),
    () => [qk.studySet(studySetId), qk.studySets, qk.jobs(studySetId)],
  );
}

export function useDeleteSource(studySetId: string) {
  return useLfMutation(
    (sourceId: string) => api<{ deleted: boolean }>(`/api/study-sets/${studySetId}/sources/${sourceId}`, { method: "DELETE" }),
    () => [qk.studySet(studySetId), qk.studySets, qk.jobs(studySetId), qk.guide(studySetId)],
  );
}

export function usePatchSource(studySetId: string) {
  return useLfMutation(
    (vars: { sourceId: string; title?: string; description?: string | null }) =>
      api<{ updated: boolean }>(`/api/study-sets/${studySetId}/sources/${vars.sourceId}`, {
        method: "PATCH",
        body: JSON.stringify({ title: vars.title, description: vars.description }),
      }),
    (vars) => [qk.source(studySetId, vars.sourceId), qk.studySet(studySetId)],
  );
}

export function usePatchSegment() {
  return useLfMutation(
    (vars: { segmentId: string; text?: string; flagged?: boolean; note?: string | null }) =>
      api<{ segment: unknown }>(`/api/transcript-segments/${vars.segmentId}`, {
        method: "PATCH",
        body: JSON.stringify({ text: vars.text, flagged: vars.flagged, note: vars.note }),
      }),
    () => [],
  );
}

export function useGenerateGuide(studySetId: string) {
  return useLfMutation(
    (body?: { style?: string; regenerate?: boolean }) =>
      api<{ guideId: string; jobId: string }>(`/api/study-sets/${studySetId}/guide`, { method: "POST", body: JSON.stringify(body ?? {}) }),
    () => [qk.guide(studySetId), qk.jobs(studySetId), qk.studySet(studySetId)],
  );
}

export function usePatchGuideSection(studySetId: string) {
  return useLfMutation(
    (vars: { sectionId: string; title?: string; content?: string }) =>
      api<{ section: GuideSectionRow }>(`/api/study-sets/${studySetId}/guide/sections/${vars.sectionId}`, {
        method: "PATCH",
        body: JSON.stringify({ title: vars.title, content: vars.content }),
      }),
    () => [qk.guide(studySetId)],
  );
}

export function useRegenerateSection(studySetId: string) {
  return useLfMutation(
    (sectionId: string) =>
      api<{ jobId: string }>(`/api/study-sets/${studySetId}/guide/sections/${sectionId}`, { method: "POST" }),
    () => [qk.guide(studySetId), qk.jobs(studySetId)],
  );
}

export function useGenerateRecap(studySetId: string) {
  return useLfMutation(
    (guideId: string) => api<{ jobId: string }>(`/api/study-sets/${studySetId}/guide/recap`, { method: "POST", body: JSON.stringify({ guideId }) }),
    () => [qk.guide(studySetId), qk.jobs(studySetId)],
  );
}

export function useGenerateDeck(studySetId: string) {
  return useLfMutation(
    (body?: { deckId?: string; name?: string; focus?: string; count?: number; cardTypes?: string[] }) =>
      api<{ deckId: string; jobId: string }>(`/api/study-sets/${studySetId}/flashcards`, { method: "POST", body: JSON.stringify(body ?? {}) }),
    () => [qk.decks(studySetId), qk.jobs(studySetId), qk.studySet(studySetId)],
  );
}

export function useReviewCard(deckId: string) {
  return useLfMutation(
    (body: { cardId: string; grade: 1 | 2 | 3 | 4 }) =>
      api<{ card: FlashcardRow; intervalDays: number; retrievabilityBefore: number | null }>(`/api/decks/${deckId}/review`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    // Prefix-match ["deck", deckId] covers both the all-cards and due-only variants.
    () => [qk.deck(deckId), ["deck"], ["decks"], ["study-set"], ["study-sets"]],
  );
}

export function useEditCard(deckId: string) {
  return useLfMutation(
    (vars: { cardId: string; front?: string; back?: string; suspended?: boolean }) =>
      api<{ card: unknown }>(`/api/cards/${vars.cardId}`, {
        method: "PATCH",
        body: JSON.stringify({ front: vars.front, back: vars.back, suspended: vars.suspended }),
      }),
    () => [qk.deck(deckId), qk.deck(deckId, true)],
  );
}

export function useDeleteCard(deckId: string) {
  return useLfMutation(
    (cardId: string) => api<{ deleted: boolean }>(`/api/cards/${cardId}`, { method: "DELETE" }),
    () => [qk.deck(deckId), qk.deck(deckId, true)],
  );
}

export function useGenerateQuiz(studySetId: string) {
  return useLfMutation(
    (body?: { title?: string; topic?: string; count?: number; types?: string[]; difficulty?: string }) =>
      api<{ quizId: string; jobId: string; difficulty: string; adaptiveReason?: string }>(`/api/study-sets/${studySetId}/quiz`, {
        method: "POST",
        body: JSON.stringify(body ?? {}),
      }),
    () => [qk.quizzes(studySetId), qk.jobs(studySetId), qk.studySet(studySetId)],
  );
}

export interface QuizAttemptResult {
  score: number;
  results: {
    questionId: string;
    correct: boolean;
    score: number;
    expected: string;
    feedback: string;
    correctAnswer: unknown;
    explanation: string | null;
    distractorRationale: Record<string, string> | null;
    options: { id: string; text: string }[] | null;
  }[];
  weakTopics: string[];
}

export function useSubmitQuizAttempt(studySetId: string) {
  return useLfMutation(
    (vars: {
      quizId: string;
      answers: { questionId: string; selectedIds?: string[]; text?: string; numeric?: number; order?: string[]; pairs?: Record<string, string>; skipped?: boolean }[];
    }) =>
      api<QuizAttemptResult>(`/api/quizzes/${vars.quizId}/attempts`, {
        method: "POST",
        body: JSON.stringify({ answers: vars.answers }),
      }),
    () => [qk.studySet(studySetId), qk.analytics(studySetId)],
  );
}

export function useGenerateExercises(studySetId: string) {
  return useLfMutation(
    (body?: { title?: string; types?: string[]; difficulty?: string; count?: number; topic?: string }) =>
      api<{ exerciseSetId: string; jobId: string }>(`/api/study-sets/${studySetId}/exercises`, { method: "POST", body: JSON.stringify(body ?? {}) }),
    () => [qk.exerciseSets(studySetId), qk.jobs(studySetId), qk.studySet(studySetId)],
  );
}

export function useSubmitExerciseAttempt() {
  return useLfMutation(
    // Wire format: { submission } — the route's zod schema validates that key.
    (vars: { exerciseId: string; submission: string; durationMs?: number }) =>
      api<{ feedback: { score: number; summary: string; criteria: { name: string; met: boolean; comment: string }[]; nextStep: string } | null }>(
        `/api/exercises/${vars.exerciseId}`,
        { method: "POST", body: JSON.stringify({ submission: vars.submission, durationMs: vars.durationMs }) },
      ),
    () => [],
  );
}

export function useRevealSolution() {
  return useLfMutation(
    (exerciseId: string) => api<{ solution: string }>(`/api/exercises/${exerciseId}/solution`, { method: "POST" }),
    () => [],
  );
}

export function useCreateConversation(studySetId: string) {
  return useLfMutation(
    (title?: string) =>
      api<{ conversation: TutorConversationRow }>(`/api/study-sets/${studySetId}/tutor`, {
        method: "POST",
        body: JSON.stringify(title ? { title } : {}),
      }),
    () => [qk.tutor(studySetId), qk.studySet(studySetId)],
  );
}

export interface TutorReply {
  userMessage: TutorMessageRow;
  reply: TutorMessageRow;
}

export function useSendTutorMessage(studySetId: string, conversationId: string) {
  return useLfMutation(
    (body: { content: string; mode?: "answer" | "hint" | "explain_differently" | "show_source" | "challenge" | "reveal_solution" }) =>
      api<{ reply: TutorReply["reply"] }>(`/api/tutor/${conversationId}/messages`, { method: "POST", body: JSON.stringify(body) }),
    () => [qk.tutorMessages(conversationId), qk.tutor(studySetId)],
  );
}

/* --------------------- composite client-side workflows -------------------- */

/**
 * Full file-source workflow: create source → PUT bytes to ticket → confirm.
 * `onProgress` reports the byte-upload fraction for this file.
 */
export function useUploadSourceWorkflow(studySetId: string) {
  const addFile = useAddFileSource(studySetId);
  const complete = useCompleteUpload(studySetId);

  const run = useCallback(
    async (file: File, opts?: { title?: string; consent?: boolean; onProgress?: (fraction: number) => void }) => {
      const created = await addFile.mutateAsync({
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        title: opts?.title,
        consent: opts?.consent,
      });
      await uploadToTicket(created.upload, file, opts?.onProgress);
      const done = await complete.mutateAsync({ sourceId: created.source.id });
      return { source: created.source, jobId: done.jobId };
    },
    [addFile, complete],
  );

  return { run, pending: addFile.isPending || complete.isPending, error: addFile.error ?? complete.error };
}
