"use client";

import { useParams } from "next/navigation";
import { ArrowRight, Brain, CalendarRange, Lightbulb, Target, TrendingDown, TrendingUp } from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/misc";
import { useAnalytics } from "@/hooks/use-api";
import { cn } from "@/lib/utils";

export default function AnalyticsPage() {
  const { studySetId } = useParams<{ studySetId: string }>();
  const { data, isLoading } = useAnalytics(studySetId);

  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  const maxMinutes = Math.max(1, ...data.timeStudied.byDay.map((d) => d.minutes));
  const topics = [...data.topics].sort((a, b) => a.mastery - b.mastery);
  const weakCount = topics.filter((t) => t.mastery < 0.5).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Analytics</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Mastery is an EWMA of your graded attempts — every recommendation explains exactly what it&apos;s based on.
        </p>
      </div>

      {/* Stat tiles — headline numbers are not charts */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Predicted retention"
          value={data.flashcards.meanRetention != null ? `${data.flashcards.meanRetention}%` : "—"}
          hint={`${data.flashcards.scheduled} scheduled · ${data.flashcards.mature} mature`}
        />
        <StatTile label="Cards due now" value={String(data.flashcards.due)} hint={`${data.flashcards.total} cards total`} href={`/study-sets/${studySetId}/flashcards`} />
        <StatTile
          label="Time studied"
          value={data.timeStudied.totalMinutes >= 60 ? `${Math.round((data.timeStudied.totalMinutes / 60) * 10) / 10}h` : `${data.timeStudied.totalMinutes}m`}
          hint="across all activities"
        />
        <StatTile label="Weakest topics" value={String(weakCount)} hint={weakCount === 0 ? "nothing under 50% — nice" : "under 50% mastery"} />
      </div>

      {/* Recommendations — transparent, each with its reason */}
      {data.recommendations.length > 0 && (
        <Card className="border-primary/30">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Lightbulb className="h-3.5 w-3.5 text-primary" aria-hidden="true" /> What to do next
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.recommendations.map((r, i) => (
              <div key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2">
                <p className="min-w-0 flex-1 text-sm">{r.message}</p>
                {r.action && (
                  <Link href={r.action.href} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                    {r.action.label} <ArrowRight className="h-3 w-3" aria-hidden="true" />
                  </Link>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Topic mastery — horizontal magnitude bars, weakest first */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Brain className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" /> Topic mastery
            </CardTitle>
          </CardHeader>
          <CardContent>
            {topics.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Take a quiz or review cards — mastery appears as you study.</p>
            ) : (
              <ul className="space-y-3">
                {topics.slice(0, 8).map((t) => (
                  <li key={t.topic} className="group">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 flex-1 truncate text-xs" title={t.topic}>{t.topic}</span>
                      <span className="flex shrink-0 items-center gap-1.5 text-xs tabular-nums text-muted-foreground">
                        {t.trend === "up" && <TrendingUp className="h-3 w-3 text-[hsl(var(--success))]" aria-label="improving" />}
                        {t.trend === "down" && <TrendingDown className="h-3 w-3 text-destructive" aria-label="declining" />}
                        {Math.round(t.mastery * 100)}%
                      </span>
                    </div>
                    <div
                      className="mt-1 h-2 overflow-hidden rounded-full bg-muted"
                      role="meter"
                      aria-valuenow={Math.round(t.mastery * 100)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${t.topic}: ${Math.round(t.mastery * 100)}% mastery over ${t.attempts} attempts`}
                    >
                      <div
                        className={cn(
                          "h-full rounded-full transition-all group-hover:opacity-80",
                          t.mastery >= 0.7 ? "bg-[hsl(var(--success))]" : t.mastery >= 0.4 ? "bg-primary" : "bg-[hsl(var(--warning))]",
                        )}
                        style={{ width: `${Math.max(3, Math.round(t.mastery * 100))}%` }}
                        title={`${Math.round(t.mastery * 100)}% · ${t.attempts} attempts`}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-[11px] text-muted-foreground">
              Green ≥ 70% · teal 40–70% · amber &lt; 50% needs attention. Bars are the same measure (mastery) on one scale.
            </p>
          </CardContent>
        </Card>

        {/* Accuracy by difficulty — column bars, one axis */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Target className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" /> Accuracy by difficulty
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.accuracy.byDifficulty.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No graded questions yet.</p>
            ) : (
              <div className="flex h-44 items-end justify-around gap-3">
                {data.accuracy.byDifficulty.map((d) => (
                  <div key={d.difficulty} className="group flex h-full w-full max-w-[72px] flex-col items-center justify-end gap-1.5">
                    <span className="text-xs font-medium tabular-nums">{d.accuracy}%</span>
                    <div
                      className="w-full rounded-t-md bg-primary/80 transition-colors group-hover:bg-primary"
                      style={{ height: `${Math.max(2, d.accuracy)}%` }}
                      role="meter"
                      aria-valuenow={d.accuracy}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${d.difficulty}: ${d.accuracy}% accuracy over ${d.attempts} attempts`}
                      title={`${d.difficulty}: ${d.accuracy}% (${d.attempts} attempts)`}
                    />
                    <span className="text-[11px] capitalize text-muted-foreground">{d.difficulty}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Time studied — day bars */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <CalendarRange className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" /> Time studied — last 14 days
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.timeStudied.byDay.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Study sessions will appear here.</p>
          ) : (
            <div className="flex h-36 items-end gap-1.5 sm:gap-2">
              {data.timeStudied.byDay.map((d) => (
                <div key={d.day} className="group flex h-full flex-1 flex-col items-center justify-end gap-1">
                  <span className="text-[10px] font-medium tabular-nums opacity-0 transition-opacity group-hover:opacity-100">{d.minutes}m</span>
                  <div
                    className="w-full rounded-t-sm bg-primary/60 transition-colors group-hover:bg-primary"
                    style={{ height: `${Math.max(2, (d.minutes / maxMinutes) * 100)}%` }}
                    title={`${d.day}: ${d.minutes} min`}
                    role="meter"
                    aria-valuenow={d.minutes}
                    aria-valuemin={0}
                    aria-valuemax={maxMinutes}
                    aria-label={`${d.day}: ${d.minutes} minutes`}
                  />
                  <span className="text-[9px] text-muted-foreground">{d.day.slice(5)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Accuracy by objective — a table (identity + magnitude, many rows) */}
      {data.accuracy.byObjective.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Accuracy by learning objective</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="scroll-thin max-h-72 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background">
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th scope="col" className="py-2 pr-2 font-medium">Objective</th>
                    <th scope="col" className="py-2 pr-2 text-right font-medium">Accuracy</th>
                    <th scope="col" className="py-2 text-right font-medium">Attempts</th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.accuracy.byObjective].sort((a, b) => a.accuracy - b.accuracy).map((o) => (
                    <tr key={o.objective} className="border-b border-border/50">
                      <td className="py-2 pr-2">{o.objective}</td>
                      <td className="py-2 pr-2 text-right">
                        <Badge variant={o.accuracy >= 70 ? "success" : o.accuracy >= 40 ? "secondary" : "warning"}>{o.accuracy}%</Badge>
                      </td>
                      <td className="py-2 text-right tabular-nums text-muted-foreground">{o.attempts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatTile({ label, value, hint, href }: { label: string; value: string; hint?: string; href?: string }) {
  const body = (
    <Card className={href ? "transition-colors hover:border-primary/40" : undefined}>
      <CardContent className="py-4">
        <p className="text-2xl font-semibold tabular-nums leading-none">{value}</p>
        <p className="mt-1.5 text-xs font-medium text-muted-foreground">{label}</p>
        {hint && <p className="mt-0.5 text-[11px] text-muted-foreground/80">{hint}</p>}
      </CardContent>
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}
