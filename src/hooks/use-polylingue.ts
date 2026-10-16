"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/hooks/use-api";
import type { Cefr } from "@/lib/polylingue/levels";
import type { CourseSummary } from "@/lib/polylingue/service";
import type { LessonWord, PlayerExercise } from "@/lib/polylingue/content";
import type { Verdict } from "@/lib/polylingue/check";

/** React Query hooks for PolyLingue (/api/polylingue/...). */

export type { CourseSummary };

export interface CourseDetail extends CourseSummary {
  units: {
    title: string;
    theme: string;
    grammar: string;
    lessons: { id: string; title: string; focus: string; ready: boolean; completed: boolean; bestScore: number }[];
  }[];
  /** Personal lessons made from the learner's own sources. */
  sourceLessons: { id: string; title: string; source: string; ready: boolean; failed: boolean; completed: boolean; bestScore: number }[];
}

export interface PlayerLesson {
  id: string;
  title: string;
  unitTitle: string;
  status: "QUEUED" | "GENERATING" | "READY" | "FAILED";
  error: string | null;
  /** Adaptive mode, within the chosen level: support, normal or challenge. */
  mode: import("@/lib/polylingue/adapt").Mode;
  content: { intro: string; words: LessonWord[]; exercises: (PlayerExercise & import("@/lib/polylingue/adapt").AdaptedFields & { glossable: string[] })[] } | null;
}

export interface AnswerResult {
  verdict: Verdict;
  expected: string;
  note?: string;
  xp: number;
  explanation: string;
  audio: string | null;
}

export interface ReviewCard {
  id: string;
  term: string;
  translation: string;
  example: string | null;
  exampleTranslation: string | null;
  partOfSpeech: string | null;
  state: string;
  reps: number;
}

export interface ProgressStats {
  xp: number;
  streak: number;
  bestStreak: number;
  /** Streak freezes held, and XP towards the next one. */
  streakFreezes: number;
  freezeXp: number;
  lessonsDone: number;
  words: number;
  mastered: number;
  accuracy: number | null;
  activeDays: number;
  days: { day: string; xp: number; minutes: number; frozen: boolean }[];
  weakWords: { id: string; term: string; translation: string; lapses: number }[];
  dailyGoalMinutes: number;
  skills: { name: string; answers: number; accuracy: number | null }[];
  mode: { mode: "support" | "normal" | "challenge"; accuracy: number | null; answers: number };
}

const keys = {
  courses: ["polylingue", "courses"] as const,
  course: (id: string) => ["polylingue", "course", id] as const,
  lesson: (courseId: string, lessonId: string) => ["polylingue", "lesson", courseId, lessonId] as const,
  review: (id: string) => ["polylingue", "review", id] as const,
  progress: (id: string) => ["polylingue", "progress", id] as const,
};

const writing = (status?: string) => status === "QUEUED" || status === "GENERATING";

export function usePolyCourses() {
  return useQuery({
    queryKey: keys.courses,
    queryFn: () => api<{ courses: CourseSummary[] }>("/api/polylingue/courses"),
    refetchInterval: (q) => (q.state.data?.courses.some((c) => writing(c.curriculum.status)) ? 3000 : false),
  });
}

export function useStartCourse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { level: Cefr; targetLang: string; baseLang: string; dailyGoalMinutes: number; timeZone: string }) =>
      api<{ course: CourseSummary }>("/api/polylingue/courses", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: keys.courses });
      void qc.invalidateQueries({ queryKey: keys.course(data.course.id) });
    },
  });
}

export function usePolyCourse(courseId: string) {
  return useQuery({
    queryKey: keys.course(courseId),
    queryFn: () => api<CourseDetail>(`/api/polylingue/courses/${courseId}`),
    refetchInterval: (q) => (writing(q.state.data?.curriculum.status) ? 3000 : false),
  });
}

export function useUpdateCourse(courseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { level?: Cefr; baseLang?: string; dailyGoalMinutes?: number }) =>
      api<{ course: CourseSummary }>(`/api/polylingue/courses/${courseId}`, { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.courses });
      void qc.invalidateQueries({ queryKey: keys.course(courseId) });
    },
  });
}

export function useDeleteCourse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (courseId: string) => api<{ deleted: boolean }>(`/api/polylingue/courses/${courseId}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.courses }),
  });
}

export function usePlayerLesson(courseId: string, lessonId: string) {
  return useQuery({
    queryKey: keys.lesson(courseId, lessonId),
    queryFn: () => api<PlayerLesson>(`/api/polylingue/courses/${courseId}/lessons/${lessonId}`),
    refetchInterval: (q) => (q.state.data && q.state.data.status !== "READY" && q.state.data.status !== "FAILED" ? 2000 : false),
    staleTime: Infinity,
  });
}

export function useAnswer(courseId: string, lessonId: string) {
  return useMutation({
    mutationFn: (input: { index: number; answer: string; retry: boolean; hinted?: boolean }) =>
      api<AnswerResult>(`/api/polylingue/courses/${courseId}/lessons/${lessonId}/answer`, { method: "POST", body: JSON.stringify(input) }),
  });
}

export function useHint(courseId: string, lessonId: string) {
  return useMutation({
    mutationFn: (index: number) =>
      api<{ hint: string }>(`/api/polylingue/courses/${courseId}/lessons/${lessonId}/hint`, { method: "POST", body: JSON.stringify({ index }) }),
  });
}

export function useCompleteLesson(courseId: string, lessonId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { firstTryCorrect: number; total: number; seconds: number }) =>
      api<{ score: number; bonusXp: number; newWords: number }>(`/api/polylingue/courses/${courseId}/lessons/${lessonId}/complete`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.course(courseId) });
      void qc.invalidateQueries({ queryKey: keys.courses });
      void qc.invalidateQueries({ queryKey: keys.progress(courseId) });
      // Badges just earned show at once.
      void qc.invalidateQueries({ queryKey: ["polylingue", "notifications"] });
    },
  });
}

export function useReviewCards(courseId: string) {
  return useQuery({
    queryKey: keys.review(courseId),
    queryFn: () => api<{ cards: ReviewCard[] }>(`/api/polylingue/courses/${courseId}/review`),
    staleTime: Infinity,
  });
}

export function useGradeCard(courseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { cardId: string; grade: 1 | 2 | 3 | 4; seconds: number }) =>
      api<{ dueAt: string; xp: number }>(`/api/polylingue/courses/${courseId}/review`, { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.course(courseId) });
      void qc.invalidateQueries({ queryKey: keys.courses });
    },
  });
}

export function useProgressStats(courseId: string) {
  return useQuery({ queryKey: keys.progress(courseId), queryFn: () => api<ProgressStats>(`/api/polylingue/courses/${courseId}/progress`) });
}

export function speechSrc(lang: string, text: string): string {
  return `/api/polylingue/speech?lang=${encodeURIComponent(lang)}&text=${encodeURIComponent(text)}`;
}

/* --------------------------- multi-skill practice -------------------------- */

export type SkillSlug = "reading" | "listening" | "writing" | "speaking";
export type PlayerPracticeContent = import("@/lib/polylingue/practice").PlayerPractice;
export type Correction = import("@/lib/polylingue/practice").Correction;

export interface PracticeListItem {
  id: string;
  unitIndex: number;
  unitTitle: string;
  theme: string;
  title: string;
  format: string | null;
  topic: string | null;
  ready: boolean;
  failed: boolean;
  completed: boolean;
  bestScore: number;
}

export interface PlayerPracticeResponse {
  id: string;
  skill: "READING" | "LISTENING" | "WRITING" | "SPEAKING";
  title: string;
  status: "QUEUED" | "GENERATING" | "READY" | "FAILED";
  error: string | null;
  content: PlayerPracticeContent | null;
}

export function usePractices(courseId: string, skill: SkillSlug) {
  return useQuery({
    queryKey: ["polylingue", "practices", courseId, skill],
    queryFn: () =>
      api<{ ready: boolean; practices: PracticeListItem[]; personal: PracticeListItem[] }>(`/api/polylingue/courses/${courseId}/practices?skill=${skill}`),
    refetchInterval: (q) =>
      q.state.data && (!q.state.data.ready || q.state.data.personal.some((p) => !p.ready && !p.failed)) ? 3000 : false,
  });
}

export function usePractice(courseId: string, practiceId: string) {
  return useQuery({
    queryKey: ["polylingue", "practice", courseId, practiceId],
    queryFn: () => api<PlayerPracticeResponse>(`/api/polylingue/courses/${courseId}/practices/${practiceId}`),
    refetchInterval: (q) => (q.state.data && q.state.data.status !== "READY" && q.state.data.status !== "FAILED" ? 2000 : false),
    staleTime: Infinity,
  });
}

export function usePracticeAnswer(courseId: string, practiceId: string) {
  return useMutation({
    mutationFn: (input: { part: "question" | "dictation"; index: number; answer: string }) =>
      api<{ verdict: Verdict; expected: string; note?: string; explanation: string; xp: number }>(
        `/api/polylingue/courses/${courseId}/practices/${practiceId}/answer`,
        { method: "POST", body: JSON.stringify(input) },
      ),
  });
}

export function useWritingCorrection(courseId: string, practiceId: string) {
  return useMutation({
    mutationFn: (input: { index: number; text: string }) =>
      api<Correction & { xp: number; model: string }>(`/api/polylingue/courses/${courseId}/practices/${practiceId}/writing`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
  });
}

export type SpeakingResult =
  | { kind: "sentence"; heard: string; score: number; missed: string[]; verdict: Verdict; xp: number; expected: string }
  | ({ kind: "question"; heard: string; xp: number; model: string } & Correction);

export function useSpeakingCheck(courseId: string, practiceId: string) {
  return useMutation({
    mutationFn: async (input: { kind: "sentence" | "question"; index: number; audio: Blob }) => {
      const form = new FormData();
      form.set("kind", input.kind);
      form.set("index", String(input.index));
      form.set("audio", input.audio, "speech");
      const res = await fetch(`/api/polylingue/courses/${courseId}/practices/${practiceId}/speaking`, { method: "POST", body: form });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      return (await res.json()) as SpeakingResult;
    },
  });
}

export function useCompletePractice(courseId: string, practiceId: string, skill: SkillSlug) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { score: number; seconds: number }) =>
      api<{ score: number; bonusXp: number; reveal: { dictation: string[]; passage: string[] } | null }>(
        `/api/polylingue/courses/${courseId}/practices/${practiceId}/complete`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["polylingue", "practices", courseId, skill] });
      void qc.invalidateQueries({ queryKey: keys.course(courseId) });
      void qc.invalidateQueries({ queryKey: keys.courses });
    },
  });
}

export function useAddWord(courseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { term: string; translation: string; example?: string }) =>
      api<{ added: boolean }>(`/api/polylingue/courses/${courseId}/words`, { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.course(courseId) }),
  });
}

export function practiceAudioSrc(courseId: string, practiceId: string, part: "dictation" | "passage", index: number): string {
  return `/api/polylingue/courses/${courseId}/practices/${practiceId}/audio?part=${part}&index=${index}`;
}

/* ---------------------------- weak-word practice --------------------------- */

export type WeakExercise = import("@/lib/polylingue/weak").WeakExercise;

export function useWeakSession(courseId: string) {
  return useQuery({
    queryKey: ["polylingue", "weak", courseId],
    queryFn: () => api<{ enough: boolean; exercises: WeakExercise[] }>(`/api/polylingue/courses/${courseId}/weak`),
    staleTime: Infinity,
    gcTime: 0,
  });
}

export function useWeakAnswer(courseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { cardId: string; kind: WeakExercise["kind"]; answer: string }) =>
      api<{ verdict: Verdict; expected: string; note?: string; xp: number; term: string; translation: string }>(
        `/api/polylingue/courses/${courseId}/weak`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.course(courseId) }),
  });
}

/* ------------------------------- placement test ---------------------------- */

export type PlayerPlacementItem = import("@/lib/polylingue/placement").PlayerPlacementItem;

export function usePlacementBank(target: string | null, base: string | null) {
  return useQuery({
    queryKey: ["polylingue", "placement", target, base],
    queryFn: () =>
      api<{ status: string; error: string | null; items: PlayerPlacementItem[] | null }>(`/api/polylingue/placement?target=${target}&base=${base}`),
    enabled: Boolean(target && base),
    refetchInterval: (q) => (q.state.data && !q.state.data.items && q.state.data.status !== "FAILED" ? 3000 : false),
  });
}

export function usePlacementAnswer() {
  return useMutation({
    mutationFn: (input: { target: string; base: string; id: number; answer: string }) =>
      api<{ correct: boolean; expected: string; explanation: string }>("/api/polylingue/placement/answer", { method: "POST", body: JSON.stringify(input) }),
  });
}

/** Generates a personal reading (kind of source + subject) at the course level. */
export function useCreateReading(courseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { format: string; topic: string; customTopic?: string }) =>
      api<{ id: string }>(`/api/polylingue/courses/${courseId}/practices`, { method: "POST", body: JSON.stringify({ skill: "reading", ...input }) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["polylingue", "practices", courseId, "reading"] }),
  });
}

/* ----------------------- learn from your own material ---------------------- */

export interface EligibleSource {
  id: string;
  title: string;
  type: string;
  studySetId: string;
  studySetTitle: string;
  via: "original" | "translation";
}

export function useEligibleSources(courseId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["polylingue", "sources", courseId],
    queryFn: () => api<{ sources: EligibleSource[] }>(`/api/polylingue/courses/${courseId}/source-lessons`),
    enabled,
  });
}

export function useSourceParts(courseId: string, sourceId: string | null) {
  return useQuery({
    queryKey: ["polylingue", "source-parts", courseId, sourceId],
    queryFn: () => api<{ parts: number; preview: string[]; made: string[] }>(`/api/polylingue/courses/${courseId}/source-lessons?source=${sourceId}`),
    enabled: Boolean(sourceId),
  });
}

export function useCreateSourceLesson(courseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { sourceId: string; part: number }) =>
      api<{ id: string }>(`/api/polylingue/courses/${courseId}/source-lessons`, { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.course(courseId) }),
  });
}

/* ------------------------------------------------- habit and motivation (3) */

export type PolyNotifications = Awaited<ReturnType<typeof import("@/lib/polylingue/habits-service").notifications>>;
export type AchievementsView = { courses: Awaited<ReturnType<typeof import("@/lib/polylingue/habits-service").listAchievements>> };
export type LeaguesView = Awaited<ReturnType<typeof import("@/lib/polylingue/habits-service").myLeagues>>;
export type WeeklySummary = Awaited<ReturnType<typeof import("@/lib/polylingue/habits-service").weeklySummary>>;
export interface ReminderView {
  enabled: boolean;
  time: string;
  timeZone: string;
  streakWarning: boolean;
  push: boolean;
  weeklySummary: boolean;
  pushAvailable: boolean;
  vapidPublicKey: string | null;
  browsers: number;
}

const habitKeys = {
  notifications: ["polylingue", "notifications"] as const,
  achievements: ["polylingue", "achievements"] as const,
  leagues: ["polylingue", "leagues"] as const,
  reminders: ["polylingue", "reminders"] as const,
  summary: (week: string | null) => ["polylingue", "summary", week ?? "last"] as const,
};

/** Badges to announce and reminders due, checked every minute and when the window gets focus. */
export function usePolyNotifications() {
  return useQuery({
    queryKey: habitKeys.notifications,
    queryFn: () => api<PolyNotifications>("/api/polylingue/notifications"),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useMarkBadgesSeen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => api<{ ok: true }>("/api/polylingue/notifications/seen", { method: "POST", body: JSON.stringify({ ids }) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: habitKeys.notifications }),
  });
}

export function useAchievements() {
  return useQuery({ queryKey: habitKeys.achievements, queryFn: () => api<AchievementsView>("/api/polylingue/achievements") });
}

export function useLeagues() {
  return useQuery({ queryKey: habitKeys.leagues, queryFn: () => api<LeaguesView>("/api/polylingue/leagues"), refetchInterval: 60_000 });
}

export function useCreateLeague() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; nickname: string }) => api<{ id: string; code: string }>("/api/polylingue/leagues", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: habitKeys.leagues }),
  });
}

export function useJoinLeague() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { code: string; nickname: string }) => api<{ id: string; name: string }>("/api/polylingue/leagues/join", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: habitKeys.leagues }),
  });
}

export function useLeaveLeague() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (leagueId: string) => api<{ ok: true }>(`/api/polylingue/leagues/${leagueId}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: habitKeys.leagues }),
  });
}

export function useReminders() {
  return useQuery({ queryKey: habitKeys.reminders, queryFn: () => api<ReminderView>("/api/polylingue/reminders") });
}

export function useUpdateReminders() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<Pick<ReminderView, "enabled" | "time" | "timeZone" | "streakWarning" | "push" | "weeklySummary">>) =>
      api<ReminderView>("/api/polylingue/reminders", { method: "PUT", body: JSON.stringify(input) }),
    onSuccess: (data) => {
      qc.setQueryData(habitKeys.reminders, data);
      void qc.invalidateQueries({ queryKey: habitKeys.notifications });
    },
  });
}

export function useWeeklySummary(week: string | null) {
  return useQuery({
    queryKey: habitKeys.summary(week),
    queryFn: () => api<WeeklySummary>(`/api/polylingue/summary${week ? `?week=${week}` : ""}`),
  });
}

export function invalidateReminders(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: habitKeys.reminders });
}
