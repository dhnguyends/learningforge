"use client";

import { Lock, Snowflake, Trophy } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { targetLanguage } from "@/lib/polylingue/levels";
import { LangBadge } from "@/components/polylingue/lang-badge";
import { BADGE_ICONS } from "@/components/polylingue/habit-notices";
import { useAchievements } from "@/hooks/use-polylingue";

/** Badges per language (earned in colour, the rest to earn), and streak freezes. */
export default function PolyAchievementsPage() {
  const { data, isLoading, error } = useAchievements();

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6 sm:px-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <Trophy className="h-5 w-5 text-amber-500" aria-hidden="true" /> Badges
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">Earned by practising: lessons, streaks, words, every skill. Each language has its own.</p>
      </div>

      {error ? (
        <p className="text-sm text-destructive">{error.message}</p>
      ) : isLoading || !data ? (
        <div className="h-64 animate-pulse rounded-lg bg-muted" />
      ) : data.courses.length === 0 ? (
        <p className="text-sm text-muted-foreground">Start a language to earn badges.</p>
      ) : (
        data.courses.map((c) => {
          const earned = c.badges.filter((b) => b.earnedAt).length;
          return (
            <section key={c.courseId} className="space-y-3" aria-labelledby={`badges-${c.courseId}`}>
              <div className="flex flex-wrap items-center gap-2">
                <LangBadge code={c.targetLang} size="sm" />
                <h2 id={`badges-${c.courseId}`} className="text-base font-semibold">
                  {targetLanguage(c.targetLang)?.name ?? c.targetLang} · {c.level}
                </h2>
                <span className="text-sm text-muted-foreground">
                  {earned} of {c.badges.length}
                </span>
              </div>

              <Card>
                <CardContent className="flex flex-wrap items-center gap-3 p-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-sky-500/15 text-sky-600">
                    <Snowflake className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {c.streakFreezes} of {c.maxFreezes} streak freezes
                    </p>
                    <p className="text-xs text-muted-foreground">
                      A freeze keeps your streak through a missed day, by itself. You earn one every {c.freezeXpNeeded} XP.
                    </p>
                  </div>
                  {c.streakFreezes < c.maxFreezes && (
                    <div className="w-40">
                      <Progress value={(c.freezeXp / c.freezeXpNeeded) * 100} aria-label="XP towards the next freeze" />
                      <p className="mt-1 text-right text-[11px] tabular-nums text-muted-foreground">
                        {c.freezeXp} / {c.freezeXpNeeded} XP
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>

              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {c.badges.map((b) => {
                  const Icon = BADGE_ICONS[b.icon as keyof typeof BADGE_ICONS] ?? Trophy;
                  const got = Boolean(b.earnedAt);
                  return (
                    <li key={b.key}>
                      <Card className={cn("h-full", !got && "opacity-60")}>
                        <CardContent className="flex h-full flex-col items-center gap-1.5 p-3 text-center">
                          <span
                            className={cn(
                              "flex h-11 w-11 items-center justify-center rounded-full",
                              got ? "bg-amber-500/15 text-amber-600" : "bg-muted text-muted-foreground",
                            )}
                          >
                            {got ? <Icon className="h-5 w-5" aria-hidden="true" /> : <Lock className="h-4 w-4" aria-hidden="true" />}
                          </span>
                          <span className="text-sm font-medium">{b.title}</span>
                          <span className="text-xs text-muted-foreground">{b.description}</span>
                          {got && (
                            <span className="mt-auto text-[11px] text-muted-foreground">{new Date(b.earnedAt!).toLocaleDateString()}</span>
                          )}
                          <span className="sr-only">{got ? "Earned" : "Not earned yet"}</span>
                        </CardContent>
                      </Card>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}
