"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { LessonPlayer } from "@/components/polylingue/lesson-player";
import { usePlayerLesson, usePolyCourse } from "@/hooks/use-polylingue";

/** A PolyLingue lesson: written by the AI model the first time it is opened, then played. */
export default function PolyLessonPage() {
  const { courseId, lessonId } = useParams<{ courseId: string; lessonId: string }>();
  const { data: course } = usePolyCourse(courseId);
  const { data: lesson, error, refetch, isFetching } = usePlayerLesson(courseId, lessonId);

  const all = course?.units.flatMap((u) => u.lessons) ?? [];
  const grammar = course?.units.find((u) => u.lessons.some((l) => l.id === lessonId))?.grammar;
  const after = all[all.findIndex((l) => l.id === lessonId) + 1];
  const nextHref = after ? `/polylingue/${courseId}/lesson/${after.id}` : `/polylingue/${courseId}`;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-6 sm:px-6">
      {lesson?.status !== "READY" && (
        <Link href={`/polylingue/${courseId}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to the course
        </Link>
      )}
      {lesson && (
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{lesson.unitTitle}</p>
          <h1 className="text-xl font-semibold tracking-tight">{lesson.title}</h1>
        </div>
      )}

      {error ? (
        <p className="text-sm text-destructive">{error.message}</p>
      ) : !lesson || !course ? (
        <div className="h-64 animate-pulse rounded-lg bg-muted" />
      ) : lesson.status === "READY" && lesson.content ? (
        <LessonPlayer key={lesson.id} courseId={courseId} lang={course.targetLang} lesson={lesson} nextHref={nextHref} grammar={grammar} />
      ) : lesson.status === "FAILED" ? (
        <Card>
          <CardContent className="space-y-3 p-5 text-sm">
            <p className="text-destructive">This lesson could not be written: {lesson.error}</p>
            <Button onClick={() => void refetch()} disabled={isFetching}>
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex items-center gap-3 p-5 text-sm">
            <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
            Preparing your lesson: the AI model is writing its words and exercises (usually under a minute, then it is saved).
          </CardContent>
        </Card>
      )}
    </div>
  );
}
