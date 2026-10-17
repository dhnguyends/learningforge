"use client";

import Link from "next/link";
import { CalendarClock, Play, School } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { LangBadge } from "@/components/polylingue/lang-badge";
import { useOpenAssignments } from "@/hooks/use-polylingue";

/** Work given by the learner's teachers, soonest first (nothing when there is none). */
export function AssignmentsCard({ courseId }: { courseId?: string }) {
  const { data } = useOpenAssignments();
  const items = (data?.assignments ?? []).filter((a) => !courseId || a.courseId === courseId);
  if (items.length === 0) return null;
  const now = Date.now();

  return (
    <Card className="border-primary/40">
      <CardContent className="space-y-2 p-4">
        <div className="flex items-center gap-2">
          <School className="h-4 w-4 text-primary" aria-hidden="true" />
          <h2 className="text-base font-semibold">Assignments</h2>
          <Link href="/polylingue/classes" className="ml-auto text-xs text-primary hover:underline">
            My classes
          </Link>
        </div>
        <ul className="divide-y divide-border/60">
          {items.map((a) => {
            const hours = (new Date(a.dueAt).getTime() - now) / 3600_000;
            return (
              <li key={a.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <LangBadge code={a.targetLang} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{a.title}</span>
                  <span className="block text-xs text-muted-foreground">
                    {a.className} · {a.done} of {a.total} lesson{a.total === 1 ? "" : "s"}{a.note ? ` · ${a.note}` : ""}
                  </span>
                </span>
                <Badge
                  variant="outline"
                  className={cn("gap-1", a.state === "overdue" ? "border-red-500/50 text-red-600" : hours < 48 ? "border-amber-500/50 text-amber-700" : "")}
                >
                  <CalendarClock className="h-3 w-3" aria-hidden="true" />
                  {a.state === "overdue" ? "Overdue" : `Due ${new Date(a.dueAt).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}`}
                </Badge>
                {a.nextLessonId && a.courseId && (
                  <Button asChild size="sm" className="h-8 gap-1">
                    <Link href={`/polylingue/${a.courseId}/lesson/${a.nextLessonId}`}>
                      <Play className="h-3.5 w-3.5" aria-hidden="true" /> Start
                    </Link>
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
