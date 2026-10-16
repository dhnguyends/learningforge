"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, CalendarRange, ChevronLeft, ChevronRight, Lightbulb, Snowflake } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { targetLanguage } from "@/lib/polylingue/levels";
import { LangBadge } from "@/components/polylingue/lang-badge";
import { useWeeklySummary } from "@/hooks/use-polylingue";
import { addDays } from "@/lib/polylingue/habits";

/** Weekly summary: XP, time, words and the skills to work on, per language, week by week. */
export default function PolySummaryPage() {
  const [week, setWeek] = useState<string | null>(null);
  const { data, isLoading, error } = useWeeklySummary(week);
  const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  const thisMonday = (() => {
    const d = new Date();
    const day = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10);
    const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
    return addDays(day, -((dow + 6) % 7));
  })();

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <CalendarRange className="h-5 w-5 text-primary" aria-hidden="true" /> Weekly summary
          </h1>
          {data && (
            <p className="mt-1 text-sm text-muted-foreground">
              {fmt(data.week.start)} – {fmt(data.week.end)}
              {data.week.start === thisMonday ? " (this week, so far)" : ""}
            </p>
          )}
        </div>
        {data && (
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" className="gap-1" onClick={() => setWeek(addDays(data.week.start, -7))}>
              <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Week before
            </Button>
            <Button variant="outline" size="sm" className="gap-1" disabled={data.week.start >= thisMonday} onClick={() => setWeek(addDays(data.week.start, 7))}>
              Week after <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        )}
      </div>

      {error ? (
        <p className="text-sm text-destructive">{error.message}</p>
      ) : isLoading || !data ? (
        <div className="h-64 animate-pulse rounded-lg bg-muted" />
      ) : data.languages.length === 0 ? (
        <p className="text-sm text-muted-foreground">Start a language to get a weekly summary.</p>
      ) : (
        data.languages.map((l) => (
          <Card key={l.courseId}>
            <CardContent className="space-y-4 p-4">
              <div className="flex items-center gap-2">
                <LangBadge code={l.targetLang} size="sm" />
                <h2 className="text-base font-semibold">
                  {targetLanguage(l.targetLang)?.name ?? l.targetLang} · {l.level}
                </h2>
                <Link href={`/polylingue/${l.courseId}`} className="ml-auto text-sm text-primary hover:underline">
                  Open the course
                </Link>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="XP" value={l.xp} before={l.xpBefore} />
                <Stat label="Minutes" value={l.minutes} before={l.minutesBefore} />
                <Stat label="Active days" value={`${l.activeDays} / 7`} sub={`Goal met on ${l.goalDays}`} />
                <Stat label="New words" value={l.newWords} sub={`${l.lessons} lessons · ${l.reviews} reviews`} />
              </div>

              <div className="grid grid-cols-7 gap-1.5" role="list" aria-label="XP per day">
                {l.days.map((d) => (
                  <div
                    key={d.day}
                    role="listitem"
                    title={d.frozen && d.xp === 0 ? `${d.day}: streak freeze` : `${d.day}: ${d.xp} XP, ${d.minutes} min`}
                    className={cn(
                      "flex flex-col items-center rounded-md py-1.5 text-[11px]",
                      d.xp > 0 ? "bg-emerald-500/15" : d.frozen ? "bg-sky-500/15" : "bg-muted",
                    )}
                  >
                    <span className="text-muted-foreground">{new Date(`${d.day}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "narrow" })}</span>
                    <span className="font-medium tabular-nums">
                      {d.frozen && d.xp === 0 ? <Snowflake className="h-3.5 w-3.5 text-sky-600" aria-label="Streak freeze" /> : d.xp}
                    </span>
                  </div>
                ))}
              </div>

              <div>
                <h3 className="mb-2 text-sm font-semibold">Accuracy by skill</h3>
                <ul className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
                  {l.skills.map((k) => (
                    <li key={k.name} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{k.name}</span>
                      <span
                        className={cn(
                          "tabular-nums",
                          k.accuracy == null ? "text-muted-foreground" : k.accuracy >= 80 ? "text-emerald-600" : k.accuracy >= 60 ? "text-amber-600" : "text-red-600",
                        )}
                        title={`${k.answers} answers`}
                      >
                        {k.accuracy == null ? "–" : `${k.accuracy}%`}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              {l.focus.length > 0 ? (
                <div className="rounded-lg bg-amber-500/10 p-3">
                  <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
                    <Lightbulb className="h-4 w-4 text-amber-600" aria-hidden="true" /> To work on
                  </h3>
                  <ul className="list-disc space-y-0.5 pl-5 text-sm">
                    {l.focus.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-sm text-emerald-700 dark:text-emerald-400">A balanced week: keep it up!</p>
              )}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}

function Stat({ label, value, before, sub }: { label: string; value: number | string; before?: number; sub?: string }) {
  const diff = typeof value === "number" && before !== undefined ? value - before : null;
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-baseline gap-1.5">
        <span className="text-lg font-semibold tabular-nums">{value}</span>
        {diff !== null && diff !== 0 && (
          <span className={cn("inline-flex items-center text-xs tabular-nums", diff > 0 ? "text-emerald-600" : "text-red-600")} title={`Week before: ${before}`}>
            {diff > 0 ? <ArrowUp className="h-3 w-3" aria-hidden="true" /> : <ArrowDown className="h-3 w-3" aria-hidden="true" />}
            {Math.abs(diff)}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{label}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}
