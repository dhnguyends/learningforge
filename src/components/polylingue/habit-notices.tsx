"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { BookOpen, Brain, CalendarRange, Download, Flame, Layers, Snowflake, Sparkles, Star, Target, Trophy, WifiOff, X, FileText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { LangBadge } from "@/components/polylingue/lang-badge";
import { useMarkBadgesSeen, usePolyNotifications } from "@/hooks/use-polylingue";
import { flushOutbox, registerServiceWorker } from "@/lib/polylingue/pwa-client";

export const BADGE_ICONS = {
  sparkles: Sparkles,
  star: Star,
  flame: Flame,
  book: BookOpen,
  trophy: Trophy,
  brain: Brain,
  target: Target,
  layers: Layers,
  file: FileText,
  snowflake: Snowflake,
} as const;

/** Service worker, and results of lessons played offline sent when the connection is back. */
export function usePwaSetup() {
  const qc = useQueryClient();
  useEffect(() => {
    registerServiceWorker();
    const send = async () => {
      const applied = await flushOutbox();
      if (applied > 0) {
        toast.success(`${applied} lesson${applied > 1 ? "s" : ""} played offline ${applied > 1 ? "were" : "was"} added to your progress.`);
        void qc.invalidateQueries({ queryKey: ["polylingue"] });
      }
    };
    void send();
    window.addEventListener("online", send);
    return () => window.removeEventListener("online", send);
  }, [qc]);
}

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** "Install the app", when the browser offers it (Chrome, Edge) and PolyLingue is not installed yet. */
export function InstallButton({ className }: { className?: string }) {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  useEffect(() => {
    const offer = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPromptEvent);
    };
    const installed = () => setPrompt(null);
    window.addEventListener("beforeinstallprompt", offer);
    window.addEventListener("appinstalled", installed);
    return () => {
      window.removeEventListener("beforeinstallprompt", offer);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);
  if (!prompt) return null;
  return (
    <button
      type="button"
      className={className}
      title="Install PolyLingue as an app (home screen or desktop), with offline lessons"
      onClick={async () => {
        await prompt.prompt();
        const choice = await prompt.userChoice;
        if (choice.outcome === "accepted") toast.success("PolyLingue is installed.");
        setPrompt(null);
      }}
    >
      <Download className="h-4 w-4" aria-hidden="true" /> Install the app
    </button>
  );
}

const DISMISSED = "polylingue-dismissed";

function dismissedToday(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(DISMISSED) ?? "{}") as { day?: string; kinds?: string[] };
    return v.day === new Date().toDateString() ? (v.kinds ?? []) : [];
  } catch {
    return [];
  }
}

/**
 * Above every PolyLingue page: badges just earned (once), the reminders due
 * (daily goal, streak at risk, weekly summary; each can be dismissed for the
 * day), and a note when offline.
 */
export function HabitNotices() {
  const { data } = usePolyNotifications();
  const seen = useMarkBadgesSeen();
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setDismissed(dismissedToday());
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const badges = data?.badges ?? [];
  const reminders = (data?.reminders ?? []).filter((r) => !dismissed.includes(r.kind));
  const dismiss = (kind: string) => {
    const next = [...dismissed, kind];
    setDismissed(next);
    try {
      localStorage.setItem(DISMISSED, JSON.stringify({ day: new Date().toDateString(), kinds: next }));
    } catch {
      /* dismissed for this page only */
    }
  };

  return (
    <>
      {(!online || reminders.length > 0) && (
        <div className="space-y-2 px-4 pt-4 lg:px-6" aria-live="polite">
          {!online && (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/60 px-3 py-2 text-sm">
              <WifiOff className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              You are offline: lessons saved for offline use still work, and your results are sent when you are back online.
            </div>
          )}
          {reminders.map((r) => {
            const Icon = r.kind === "streak" ? Flame : r.kind === "summary" ? CalendarRange : Target;
            const href = r.kind === "summary" ? "/polylingue/summary" : r.courseId ? `/polylingue/${r.courseId}` : "/polylingue";
            return (
              <div
                key={r.kind}
                className={cn(
                  "flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm",
                  r.kind === "streak" ? "border-amber-500/40 bg-amber-500/10" : "border-primary/30 bg-primary/5",
                )}
              >
                <Icon className={cn("h-4 w-4 shrink-0", r.kind === "streak" ? "text-amber-600" : "text-primary")} aria-hidden="true" />
                {r.targetLang && <LangBadge code={r.targetLang} size="sm" />}
                <span className="min-w-0 flex-1">{r.text}</span>
                <Button asChild size="sm" variant={r.kind === "streak" ? "default" : "outline"} className="h-7">
                  <Link href={href}>{r.kind === "summary" ? "See it" : "Start a lesson"}</Link>
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Dismiss for today" title="Dismiss for today" onClick={() => dismiss(r.kind)}>
                  <X className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            );
          })}
        </div>
      )}

      <Dialog
        open={badges.length > 0}
        onOpenChange={(open) => {
          if (!open && badges.length) seen.mutate(badges.map((b) => b.id));
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-amber-500" aria-hidden="true" /> {badges.length > 1 ? `${badges.length} new badges` : "New badge"}
            </DialogTitle>
            <DialogDescription>Well done, keep going!</DialogDescription>
          </DialogHeader>
          <ul className="space-y-2">
            {badges.map((b) => {
              const Icon = BADGE_ICONS[b.icon as keyof typeof BADGE_ICONS] ?? Trophy;
              return (
                <li key={b.id} className="flex items-center gap-3 rounded-lg border border-border p-2.5">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-600">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{b.title}</span>
                    <span className="block text-xs text-muted-foreground">{b.description}</span>
                  </span>
                  <LangBadge code={b.targetLang} size="sm" />
                </li>
              );
            })}
          </ul>
          <div className="flex justify-end gap-2">
            <Button variant="outline" asChild onClick={() => seen.mutate(badges.map((b) => b.id))}>
              <Link href="/polylingue/achievements">All badges</Link>
            </Button>
            <Button onClick={() => seen.mutate(badges.map((b) => b.id))}>Great!</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
