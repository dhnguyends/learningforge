"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Languages, Loader2, Plus, Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Onboarding } from "@/components/polylingue/onboarding";
import { LangBadge } from "@/components/polylingue/lang-badge";
import { GoalRing, StreakBadge } from "@/components/polylingue/goal-ring";
import { targetLanguage } from "@/lib/polylingue/levels";
import { usePolyCourses } from "@/hooks/use-polylingue";
import { AssignmentsCard } from "@/components/polylingue/assignments-card";

/** PolyLingue home: the learner's languages, or the onboarding (level first) when there are none. */
export default function PolyLinguePage() {
  return (
    <Suspense fallback={null}>
      <PolyLingueHome />
    </Suspense>
  );
}

function PolyLingueHome() {
  const { data, isLoading, error } = usePolyCourses();
  const [adding, setAdding] = useState(false);
  // "Add a language" in the side panel links here with ?add=1.
  const params = useSearchParams();
  useEffect(() => {
    if (params.get("add")) setAdding(true);
  }, [params]);
  const courses = data?.courses ?? [];

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Languages className="h-6 w-6 text-primary" aria-hidden="true" /> PolyLingue
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Learn a language 10 minutes a day: short lessons, instant correction, audio and spaced review.</p>
        </div>
        {courses.length > 0 && !adding && (
          <Button variant="outline" onClick={() => setAdding(true)} className="gap-1.5">
            <Plus className="h-4 w-4" aria-hidden="true" /> Add a language
          </Button>
        )}
      </div>

      {!adding && <AssignmentsCard />}

      {isLoading ? (
        <div className="h-40 animate-pulse rounded-lg bg-muted" />
      ) : error ? (
        <p className="text-sm text-destructive">{error.message}</p>
      ) : courses.length === 0 || adding ? (
        <Onboarding taken={courses.map((c) => c.targetLang)} onCancel={courses.length ? () => setAdding(false) : undefined} />
      ) : (
        <div className="grid gap-3">
          {courses.map((c) => {
            const lang = targetLanguage(c.targetLang);
            const preparing = c.curriculum.status === "QUEUED" || c.curriculum.status === "GENERATING";
            return (
              <Link key={c.id} href={`/polylingue/${c.id}`} className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Card className="transition-colors hover:bg-muted/40">
                  <CardContent className="flex items-center gap-4 p-4">
                    <LangBadge code={c.targetLang} size="lg" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-lg font-semibold">{lang?.name ?? c.targetLang}</span>
                        <Badge variant="secondary" className="font-mono">{c.level}</Badge>
                        <StreakBadge streak={c.streak} />
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {preparing ? (
                          <span className="inline-flex items-center gap-1">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Writing your {c.level} course…
                          </span>
                        ) : c.curriculum.status === "FAILED" ? (
                          <span className="text-destructive">The course could not be written; open it to try again.</span>
                        ) : c.nextLesson ? (
                          <>Next: {c.nextLesson.title}</>
                        ) : (
                          <>Course complete</>
                        )}
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        <span>{c.xp} XP</span>
                        <span>{c.words} words</span>
                        {c.dueWords > 0 && (
                          <span className="inline-flex items-center gap-1 text-primary">
                            <Repeat className="h-3 w-3" aria-hidden="true" /> {c.dueWords} to review
                          </span>
                        )}
                      </p>
                    </div>
                    <GoalRing minutes={c.today.minutes} goal={c.dailyGoalMinutes} />
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
