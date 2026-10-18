"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/hooks/use-api";
import type { LessonContent } from "@/lib/polylingue/content";

/** Admin › PolyLingue: content review, reports, analytics, voices (Phase 5). */

type Review = typeof import("@/lib/polylingue/review");
export type AdminCurriculum = Awaited<ReturnType<Review["listCurricula"]>>[number];
export type CurriculumLessons = Awaited<ReturnType<Review["curriculumLessons"]>>;
export type LessonReview = Awaited<ReturnType<Review["lessonForReview"]>>;
export type ReportGroup = Awaited<ReturnType<Review["reportQueue"]>>[number];
export type PolyAnalytics = Awaited<ReturnType<typeof import("@/lib/polylingue/analytics").polylingueAnalytics>>;
export interface VoicesView {
  languages: {
    code: string;
    name: string;
    options: { key: string; label: string }[];
    chosen: string | null;
    current: string | null;
    /** Cloud provider of the voice in use; null for a local (Speaches) voice. */
    currentCloud: string | null;
  }[];
}

const k = {
  root: ["admin", "polylingue"] as const,
  curricula: ["admin", "polylingue", "curricula"] as const,
  curriculum: (id: string) => ["admin", "polylingue", "curricula", id] as const,
  lesson: (id: string) => ["admin", "polylingue", "lesson", id] as const,
  reports: ["admin", "polylingue", "reports"] as const,
  analytics: ["admin", "polylingue", "analytics"] as const,
  voices: ["admin", "polylingue", "voices"] as const,
};

export function useAdminCurricula() {
  return useQuery({ queryKey: k.curricula, queryFn: () => api<{ curricula: AdminCurriculum[] }>("/api/admin/polylingue/curricula") });
}

export function useAdminCurriculum(id: string | null) {
  return useQuery({ queryKey: k.curriculum(id ?? ""), queryFn: () => api<CurriculumLessons>(`/api/admin/polylingue/curricula/${id}`), enabled: Boolean(id) });
}

export function useLessonReview(id: string) {
  return useQuery({
    queryKey: k.lesson(id),
    queryFn: () => api<LessonReview>(`/api/admin/polylingue/lessons/${id}`),
    // Follow a lesson being written again.
    refetchInterval: (q) => (q.state.data?.status === "QUEUED" || q.state.data?.status === "GENERATING" ? 2000 : false),
  });
}

function useAdminMutation<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => void qc.invalidateQueries({ queryKey: k.root }) });
}

export const useSaveLesson = (id: string) =>
  useAdminMutation((v: { title?: string; content: LessonContent; note?: string }) =>
    api<{ changed: number[] }>(`/api/admin/polylingue/lessons/${id}`, { method: "PUT", body: JSON.stringify(v) }),
  );
export const useRegenerateLesson = (id: string) =>
  useAdminMutation(() => api<{ ok: true }>(`/api/admin/polylingue/lessons/${id}/regenerate`, { method: "POST" }));
export const useRetireLesson = (id: string) =>
  useAdminMutation((retired: boolean) => api<{ retired: boolean }>(`/api/admin/polylingue/lessons/${id}/retire`, { method: "POST", body: JSON.stringify({ retired }) }));
export const useRestoreVersion = (id: string) =>
  useAdminMutation((version: number) => api<{ ok: true }>(`/api/admin/polylingue/lessons/${id}/restore`, { method: "POST", body: JSON.stringify({ version }) }));
export const useDismissReports = () =>
  useAdminMutation((v: { lessonId: string; index: number }) =>
    api<{ ok: true }>(`/api/admin/polylingue/lessons/${v.lessonId}/dismiss`, { method: "POST", body: JSON.stringify({ index: v.index }) }),
  );
export const usePregenerateAudio = () =>
  useAdminMutation((curriculumId: string) => api<{ queued: number }>(`/api/admin/polylingue/curricula/${curriculumId}/audio`, { method: "POST" }));

export function useReportQueue() {
  return useQuery({ queryKey: k.reports, queryFn: () => api<{ reports: ReportGroup[] }>("/api/admin/polylingue/reports") });
}

export function usePolyAnalytics(enabled: boolean) {
  return useQuery({ queryKey: k.analytics, queryFn: () => api<PolyAnalytics>("/api/admin/polylingue/analytics"), enabled });
}

export function useVoices(enabled: boolean) {
  return useQuery({ queryKey: k.voices, queryFn: () => api<VoicesView>("/api/admin/polylingue/voices"), enabled });
}

export const useSaveVoices = () =>
  useAdminMutation((voices: Record<string, string | null>) => api<VoicesView>("/api/admin/polylingue/voices", { method: "PUT", body: JSON.stringify({ voices }) }));
