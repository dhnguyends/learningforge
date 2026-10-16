"use client";

import { checkAnswer, type CheckResult } from "@/lib/polylingue/check";
import { answerXp, lessonBonus } from "@/lib/polylingue/progress";
import type { Exercise } from "@/lib/polylingue/content";
import type { PlayerLesson } from "@/hooks/use-polylingue";

/**
 * Browser side of the installable PolyLingue: the service worker, browser
 * notifications (Web Push), lessons saved for offline use, and the results
 * of lessons played offline, sent once back online.
 */

// ---------------------------------------------------------- service worker

export function registerServiceWorker(): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err) => console.warn("[pwa] service worker", err));
}

// ------------------------------------------------------------ notifications

export type PushState = "unsupported" | "denied" | "off" | "on";

export function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  return sub ? "on" : "off";
}

function keyBytes(base64url: string): Uint8Array {
  const padded = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Asks the browser's permission, subscribes this browser and tells the server. */
export async function enablePush(vapidPublicKey: string): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";
  registerServiceWorker();
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapidPublicKey) as unknown as BufferSource }));
  const res = await fetch("/api/polylingue/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Could not turn on notifications");
  return "on";
}

export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await fetch("/api/polylingue/push", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => undefined);
  await sub.unsubscribe();
}

// ---------------------------------------------------------- offline lessons

const OFFLINE_CACHE = "polylingue-offline";
const PAGES_CACHE = "polylingue-pages-v1";
const STATIC_CACHE = "polylingue-static-v1";
const packageUrl = (courseId: string) => `/__offline__/polylingue/${courseId}.json`;

export interface OfflinePackage {
  courseId: string;
  targetLang: string;
  savedAt: string;
  lessons: { player: PlayerLesson; exercises: Exercise[] }[];
  audio: string[];
}

export function offlineSupported(): boolean {
  return typeof window !== "undefined" && "caches" in window && "serviceWorker" in navigator;
}

/**
 * Saves the next lessons for offline use: their content (with the answers,
 * to correct offline), their audio, and the pages and scripts to open them.
 */
export async function saveOffline(courseId: string, onProgress?: (done: number, total: number) => void): Promise<OfflinePackage> {
  const res = await fetch(`/api/polylingue/courses/${courseId}/offline`);
  if (!res.ok) throw new Error("Could not download the lessons");
  const pkg = (await res.json()) as OfflinePackage;
  const offline = await caches.open(OFFLINE_CACHE);
  const pages = await caches.open(PAGES_CACHE);
  const pageUrls = [`/polylingue`, `/polylingue/${courseId}`, ...pkg.lessons.map((l) => `/polylingue/${courseId}/lesson/${l.player.id}`)];
  const total = pkg.audio.length + pageUrls.length;
  let done = 0;
  const tick = () => onProgress?.(++done, total);

  for (const url of pageUrls) {
    try {
      const page = await fetch(url, { credentials: "same-origin" });
      if (page.ok && !page.redirected) {
        const html = await page.clone().text();
        await pages.put(url, page);
        // The page's scripts and styles, stored directly: on a first visit the service worker
        // does not control the page yet. URLs may contain "(app)" and sit in escaped JSON.
        const assets = [...new Set((html.match(/\/_next\/static\/[^"'\s<>]+/g) ?? []).map((a) => a.replace(/\\+$/, "")))];
        const statics = await caches.open(STATIC_CACHE);
        await Promise.all(
          assets.map(async (a) => {
            try {
              const r = await fetch(a);
              if (r.ok) await statics.put(a, r);
            } catch {
              /* fetched again next time */
            }
          }),
        );
      }
    } catch {
      /* a page that cannot be saved is fetched again next time */
    }
    tick();
  }
  for (const url of pkg.audio) {
    try {
      if (!(await offline.match(url))) {
        const clip = await fetch(url);
        if (clip.ok) await offline.put(url, clip);
      }
    } catch {
      /* missing audio only mutes that exercise offline */
    }
    tick();
  }
  await offline.put(packageUrl(courseId), new Response(JSON.stringify(pkg), { headers: { "Content-Type": "application/json" } }));
  return pkg;
}

export async function savedPackage(courseId: string): Promise<OfflinePackage | null> {
  if (!offlineSupported()) return null;
  const hit = await (await caches.open(OFFLINE_CACHE)).match(packageUrl(courseId));
  return hit ? ((await hit.json()) as OfflinePackage) : null;
}

export async function removeOffline(courseId: string): Promise<void> {
  if (!offlineSupported()) return;
  await (await caches.open(OFFLINE_CACHE)).delete(packageUrl(courseId));
}

export async function offlineLesson(courseId: string, lessonId: string) {
  const pkg = await savedPackage(courseId);
  return pkg?.lessons.find((l) => l.player.id === lessonId) ?? null;
}

// ------------------------------------------------- results played offline

const OUTBOX = "polylingue-outbox";

export interface OutboxEntry {
  syncId: string;
  courseId: string;
  lessonId: string;
  answers: { index: number; answer: string; retry: boolean; hinted?: boolean }[];
  complete: { firstTryCorrect: number; total: number; seconds: number } | null;
  /** When the run started (ms); an unfinished run is sent after ABANDONED_MS. */
  startedAt: number;
}

const ABANDONED_MS = 6 * 3600_000;

function readOutbox(): OutboxEntry[] {
  try {
    return JSON.parse(localStorage.getItem(OUTBOX) ?? "[]") as OutboxEntry[];
  } catch {
    return [];
  }
}

function writeOutbox(entries: OutboxEntry[]) {
  try {
    localStorage.setItem(OUTBOX, JSON.stringify(entries));
  } catch {
    /* storage full or blocked: results stay in memory for this page */
  }
}

export function pendingResults(): number {
  return readOutbox().length;
}

/**
 * An offline run of a lesson: answers are corrected in the browser (the
 * server corrects them again when they are sent) and kept until sent.
 */
export function offlineRun(courseId: string, lessonId: string, exercises: Exercise[]) {
  const entry: OutboxEntry = { syncId: crypto.randomUUID(), courseId, lessonId, answers: [], complete: null, startedAt: Date.now() };
  const save = () => writeOutbox([...readOutbox().filter((e) => e.syncId !== entry.syncId), entry]);
  return {
    answer(input: { index: number; answer: string; retry: boolean; hinted?: boolean }): CheckResult & { xp: number; explanation: string; audio: string | null } {
      const exercise = exercises[input.index];
      const result = checkAnswer(exercise, input.answer);
      entry.answers.push(input);
      save();
      return { ...result, xp: Math.floor(answerXp(result.verdict, input.retry) / (input.hinted ? 2 : 1)), explanation: exercise.explanation, audio: exercise.audio || null };
    },
    complete(input: { firstTryCorrect: number; total: number; seconds: number }) {
      entry.complete = input;
      save();
      const total = Math.max(1, Math.min(input.total, exercises.length));
      const score = Math.round((Math.min(input.firstTryCorrect, total) / total) * 100);
      return { score, bonusXp: lessonBonus(score), newWords: 0 };
    },
  };
}

/** Sends the results of lessons played offline; returns how many were applied. */
export async function flushOutbox(): Promise<number> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return 0;
  let applied = 0;
  for (const entry of readOutbox()) {
    if (entry.answers.length === 0 && !entry.complete) {
      if (Date.now() - entry.startedAt > ABANDONED_MS) writeOutbox(readOutbox().filter((e) => e.syncId !== entry.syncId));
      continue;
    }
    // A lesson still being played offline is sent when it is finished (or abandoned).
    if (!entry.complete && Date.now() - (entry.startedAt ?? 0) < ABANDONED_MS) continue;
    try {
      const res = await fetch(`/api/polylingue/courses/${entry.courseId}/offline/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ syncId: entry.syncId, lessonId: entry.lessonId, answers: entry.answers, complete: entry.complete }),
      });
      // Sent, or refused for good (course or lesson gone): either way it leaves the outbox.
      if (res.ok || res.status === 400 || res.status === 404) {
        writeOutbox(readOutbox().filter((e) => e.syncId !== entry.syncId));
        if (res.ok) applied++;
      }
    } catch {
      return applied; // still offline
    }
  }
  return applied;
}

/** A request that never reached the server (offline, server down), as opposed to an error it returned. */
export function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof Error && /failed to fetch|networkerror|load failed|network request failed/i.test(error.message));
}
