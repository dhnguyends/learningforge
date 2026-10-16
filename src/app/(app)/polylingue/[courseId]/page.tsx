"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, BarChart3, CheckCircle2, Circle, Lightbulb, Loader2, Play, Repeat, Settings2, Snowflake, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { GoalRing, StreakBadge } from "@/components/polylingue/goal-ring";
import { LangBadge } from "@/components/polylingue/lang-badge";
import { SourceLessons } from "@/components/polylingue/source-lessons";
import { OfflineCard, OfflineCourse } from "@/components/polylingue/offline-lessons";
import { isNetworkError } from "@/lib/polylingue/pwa-client";
import { cn } from "@/lib/utils";
import { BASE_LANGUAGES, CEFR_LEVELS, DAILY_GOALS, LEVELS, isImmersion, targetLanguage, type Cefr } from "@/lib/polylingue/levels";
import { useDeleteCourse, usePolyCourse, useStartCourse, useUpdateCourse, type CourseDetail } from "@/hooks/use-polylingue";

const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** One language: today's goal, streak, Continue / Review, and the course's units and lessons. */
export default function PolyCoursePage() {
  const { courseId } = useParams<{ courseId: string }>();
  const { data: course, isLoading, error } = usePolyCourse(courseId);
  const [settings, setSettings] = useState(false);
  const retry = useStartCourse();

  if (isLoading) return <div className="mx-auto mt-6 h-64 max-w-3xl animate-pulse rounded-lg bg-muted" />;
  // Without a connection, the lessons saved on this device.
  if (error && (isNetworkError(error) || (typeof navigator !== "undefined" && !navigator.onLine))) return <OfflineCourse courseId={courseId} />;
  if (error || !course) return <p className="mx-auto mt-6 max-w-3xl px-4 text-sm text-destructive">{error?.message ?? "Course not found"}</p>;

  const lang = targetLanguage(course.targetLang);
  const preparing = course.curriculum.status === "QUEUED" || course.curriculum.status === "GENERATING";

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6 sm:px-6">
      <Link href="/polylingue" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> PolyLingue
      </Link>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 p-5">
          <LangBadge code={course.targetLang} size="lg" />
          <div className="min-w-0 flex-1">
            <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
              {lang?.name ?? course.targetLang}
              <Badge variant="secondary" className="font-mono text-sm">{course.level}</Badge>
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {LEVELS[course.level as Cefr].name}
              {isImmersion(course.level) ? ` · taught in ${lang?.name ?? course.targetLang}` : ""} · {course.xp} XP · {course.words} words
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <StreakBadge streak={course.streak} />
              <span>Best streak {course.bestStreak}</span>
              <span
                className="inline-flex items-center gap-0.5 text-sky-600"
                title={`${course.streakFreezes} streak freeze${course.streakFreezes === 1 ? "" : "s"}: each keeps your streak through a missed day`}
              >
                <Snowflake className="h-3.5 w-3.5" aria-hidden="true" /> {course.streakFreezes}
                <span className="sr-only"> streak freezes</span>
              </span>
              {course.today.goalMet && <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">Daily goal reached</Badge>}
            </div>
          </div>
          <GoalRing minutes={course.today.minutes} goal={course.dailyGoalMinutes} size={72} />
        </CardContent>
      </Card>

      {course.curriculum.status === "READY" && <OfflineCard courseId={course.id} nextLessonId={course.nextLesson?.id ?? null} />}

      {preparing ? (
        <Card>
          <CardContent className="flex items-center gap-3 p-5 text-sm">
            <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
            <span>
              Writing your {course.level} {lang?.name} course with the AI model… This takes about a minute the first time; every learner at this
              level then shares it.
            </span>
          </CardContent>
        </Card>
      ) : course.curriculum.status === "FAILED" ? (
        <Card>
          <CardContent className="space-y-3 p-5 text-sm">
            <p className="text-destructive">The course could not be written: {course.curriculum.error}</p>
            <Button
              onClick={() =>
                retry.mutate({
                  level: course.level as Cefr,
                  targetLang: course.targetLang,
                  baseLang: course.baseLang,
                  dailyGoalMinutes: course.dailyGoalMinutes,
                  timeZone: course.timeZone,
                })
              }
              disabled={retry.isPending}
            >
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-2 sm:grid-cols-3">
          {course.nextLesson ? (
            <Button asChild size="lg" className="gap-2 sm:col-span-1">
              <Link href={`/polylingue/${course.id}/lesson/${course.nextLesson.id}`}>
                <Play className="h-4 w-4" aria-hidden="true" /> Continue
              </Link>
            </Button>
          ) : (
            <Button size="lg" disabled className="sm:col-span-1">
              Course complete
            </Button>
          )}
          <Button asChild size="lg" variant="outline" className="gap-2">
            <Link href={`/polylingue/${course.id}/review`}>
              <Repeat className="h-4 w-4" aria-hidden="true" /> Review{course.dueWords > 0 ? ` ${course.dueWords} words` : ""}
            </Link>
          </Button>
          <div className="flex gap-2">
            <Button asChild size="lg" variant="outline" className="flex-1 gap-2">
              <Link href={`/polylingue/${course.id}/progress`}>
                <BarChart3 className="h-4 w-4" aria-hidden="true" /> Progress
              </Link>
            </Button>
            <Button size="lg" variant="outline" onClick={() => setSettings(true)} aria-label="Course settings" title="Level, goal, explanations">
              <Settings2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}

      {course.recommendation && !preparing && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex flex-wrap items-center gap-3 p-4 text-sm">
            <Lightbulb className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
            <span className="flex-1">
              {course.recommendation.kind === "redo"
                ? `Recommended: redo "${course.recommendation.title}" (${course.recommendation.score}%) to consolidate it before moving on.`
                : course.recommendation.kind === "weak"
                  ? `Recommended: practise your ${course.recommendation.count} weak words.`
                  : `Recommended: review your ${course.recommendation.count} words due today.`}
            </span>
            <Button asChild size="sm">
              <Link
                href={
                  course.recommendation.kind === "redo"
                    ? `/polylingue/${course.id}/lesson/${course.recommendation.lessonId}`
                    : course.recommendation.kind === "weak"
                      ? `/polylingue/${course.id}/weak`
                      : `/polylingue/${course.id}/review`
                }
              >
                {course.recommendation.kind === "redo" ? "Redo the lesson" : course.recommendation.kind === "weak" ? "Practise weak words" : "Review"}
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {course.nextLesson && !preparing && (
        <p className="text-sm text-muted-foreground">
          Next lesson: <span className="font-medium text-foreground">{course.nextLesson.title}</span> · {course.nextLesson.unitTitle}
        </p>
      )}

      {!preparing && course.curriculum.status === "READY" && <SourceLessons course={course} />}

      <div className="space-y-3">
        {course.units.map((unit, u) => (
          <Card key={u}>
            <CardContent className="p-4">
              <h2 className="text-base font-semibold">
                Unit {u + 1} · {unit.title}
              </h2>
              <p className="mb-2 text-xs text-muted-foreground">
                {unit.theme}
                {unit.grammar ? ` · ${unit.grammar}` : ""}
              </p>
              <ul className="divide-y divide-border/60">
                {unit.lessons.map((l) => (
                  <li key={l.id}>
                    <Link
                      href={`/polylingue/${course.id}/lesson/${l.id}`}
                      className={cn("flex items-center gap-3 rounded-md px-2 py-2.5 text-sm hover:bg-muted/50", course.nextLesson?.id === l.id && "bg-primary/5")}
                    >
                      {l.completed ? (
                        <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" aria-label="Completed" />
                      ) : (
                        <Circle className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{l.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">{l.focus}</span>
                      </span>
                      {l.completed && <span className="text-xs tabular-nums text-muted-foreground">{l.bestScore}%</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>

      <CourseSettings course={course} open={settings} onOpenChange={setSettings} />
    </div>
  );
}

function CourseSettings({ course, open, onOpenChange }: { course: CourseDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const confirm = useConfirm();
  const update = useUpdateCourse(course.id);
  const remove = useDeleteCourse();
  const [level, setLevel] = useState<Cefr>(course.level as Cefr);
  const [goal, setGoal] = useState(course.dailyGoalMinutes);
  const [base, setBase] = useState(course.baseLang);

  async function save() {
    try {
      await update.mutateAsync({ level, dailyGoalMinutes: goal, baseLang: base });
      toast.success(level !== course.level ? `Switched to the ${level} course` : "Saved");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    }
  }

  async function onDelete() {
    const ok = await confirm({
      title: "Stop learning this language?",
      description: "Your XP, streak, lesson progress and words for this language are deleted. This cannot be undone.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    await remove.mutateAsync(course.id);
    router.push("/polylingue");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Course settings</DialogTitle>
          <DialogDescription>Changing the level opens that level&apos;s course; your words and XP are kept.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="pl-level">Level</Label>
              <Link href={`/polylingue/${course.id}/placement`} className="text-xs font-medium text-primary hover:underline">
                Placement test
              </Link>
            </div>
            <select id="pl-level" className={selectClass} value={level} onChange={(e) => setLevel(e.target.value as Cefr)}>
              {CEFR_LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l} · {LEVELS[l].name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pl-goal">Daily goal</Label>
            <select id="pl-goal" className={selectClass} value={goal} onChange={(e) => setGoal(Number(e.target.value))}>
              {DAILY_GOALS.map((g) => (
                <option key={g} value={g}>
                  {g} minutes
                </option>
              ))}
            </select>
          </div>
          {isImmersion(level) ? (
            <p className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
              From B2, the course is taught entirely in the language you learn: no explanation language.
            </p>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="pl-base">Explanations in</Label>
              <select id="pl-base" className={selectClass} value={base === course.targetLang ? "" : base} onChange={(e) => setBase(e.target.value)}>
                <option value="" disabled>
                  Choose…
                </option>
                {BASE_LANGUAGES.filter((l) => l.code !== course.targetLang).map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        <DialogFooter className="flex-row justify-between gap-2 sm:justify-between">
          <Button variant="ghost" className="gap-1.5 text-destructive hover:text-destructive" onClick={() => void onDelete()}>
            <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete
          </Button>
          <Button onClick={() => void save()} disabled={update.isPending || (!isImmersion(level) && base === course.targetLang)}>
            {update.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
