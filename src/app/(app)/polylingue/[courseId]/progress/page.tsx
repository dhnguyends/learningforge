"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { SpeakButtons } from "@/components/polylingue/speak";
import { StreakBadge } from "@/components/polylingue/goal-ring";
import { cn } from "@/lib/utils";
import { targetLanguage } from "@/lib/polylingue/levels";
import { MODE_LABELS } from "@/lib/polylingue/adapt";
import { usePolyCourse, useProgressStats } from "@/hooks/use-polylingue";

/** Progress: XP, streaks, lessons, words, accuracy, the last 5 weeks, and the words to strengthen. */
export default function PolyProgressPage() {
  const { courseId } = useParams<{ courseId: string }>();
  const { data: course } = usePolyCourse(courseId);
  const { data: s, isLoading, error } = useProgressStats(courseId);
  const lang = course?.targetLang ?? "en";

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6 sm:px-6">
      <Link href={`/polylingue/${courseId}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to the course
      </Link>
      <h1 className="text-xl font-semibold tracking-tight">
        Progress · {targetLanguage(lang)?.name} {course?.level}
      </h1>

      {error ? (
        <p className="text-sm text-destructive">{error.message}</p>
      ) : isLoading || !s ? (
        <div className="h-64 animate-pulse rounded-lg bg-muted" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tile label="XP" value={String(s.xp)} />
            <Tile label="Streak" value={<StreakBadge streak={s.streak} />} sub={`Best ${s.bestStreak}`} />
            <Tile label="Lessons done" value={String(s.lessonsDone)} />
            <Tile label="Active days (5 weeks)" value={String(s.activeDays)} />
            <Tile label="Words learned" value={String(s.words)} />
            <Tile label="Words mastered" value={String(s.mastered)} sub="Remembered for 3+ weeks" />
            <Tile label="Accuracy" value={s.accuracy == null ? "–" : `${s.accuracy}%`} />
            <Tile label="Daily goal" value={`${s.dailyGoalMinutes} min`} />
          </div>

          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">Accuracy by skill</h2>
                <span className="text-xs text-muted-foreground" title={MODE_LABELS[s.mode.mode].description}>
                  Lessons are in <span className="font-medium text-foreground">{MODE_LABELS[s.mode.mode].label}</span> mode
                  {s.mode.accuracy != null ? ` (${s.mode.accuracy}% over your last ${s.mode.answers} answers)` : ""}, always at your {course?.level} level
                </span>
              </div>
              <ul className="space-y-2">
                {s.skills.map((k) => (
                  <li key={k.name} className="grid grid-cols-[6.5rem_1fr_3rem] items-center gap-2 text-sm">
                    <span>{k.name}</span>
                    <span className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                      <span
                        className={cn("block h-full rounded-full", k.accuracy == null ? "" : k.accuracy >= 80 ? "bg-emerald-500" : k.accuracy >= 60 ? "bg-amber-500" : "bg-red-500")}
                        style={{ width: `${k.accuracy ?? 0}%` }}
                      />
                    </span>
                    <span className="text-right text-xs tabular-nums text-muted-foreground" title={`${k.answers} answers`}>
                      {k.accuracy == null ? "–" : `${k.accuracy}%`}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <h2 className="mb-3 text-sm font-semibold">Last 5 weeks</h2>
              <div className="grid grid-cols-7 gap-1.5" role="list" aria-label="Activity per day">
                {s.days.map((d) => {
                  const met = d.minutes >= s.dailyGoalMinutes;
                  return (
                    <div
                      key={d.day}
                      role="listitem"
                      title={`${d.day}: ${d.minutes} min, ${d.xp} XP`}
                      className={cn(
                        "flex aspect-square items-center justify-center rounded-md text-[10px] tabular-nums",
                        d.xp === 0 ? "bg-muted text-muted-foreground" : met ? "bg-emerald-500 text-white" : "bg-emerald-500/30",
                      )}
                    >
                      {Number(d.day.slice(8))}
                    </div>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">Green: daily goal reached · light green: some practice</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <h2 className="mb-2 text-sm font-semibold">Words to strengthen</h2>
              {s.weakWords.length === 0 ? (
                <p className="text-sm text-muted-foreground">None yet. Words you forget will show here.</p>
              ) : (
                <ul className="divide-y divide-border/60">
                  {s.weakWords.map((w) => (
                    <li key={w.id} className="flex items-center gap-3 py-2 text-sm">
                      <SpeakButtons lang={lang} text={w.term} size="sm" />
                      <span className="font-medium">{w.term}</span>
                      <span className="text-muted-foreground">· {w.translation}</span>
                      {w.lapses > 0 && <span className="ml-auto text-xs text-muted-foreground">forgotten {w.lapses}×</span>}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-lg font-semibold tabular-nums">{value}</div>
        <p className="text-xs text-muted-foreground">{label}</p>
        {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}
