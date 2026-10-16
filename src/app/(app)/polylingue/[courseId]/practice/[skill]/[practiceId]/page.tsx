"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ListeningPlayer, ReadingPlayer, SpeakingPlayer, WritingPlayer } from "@/components/polylingue/practice-players";
import { usePolyCourse, usePractice, type PlayerPracticeContent } from "@/hooks/use-polylingue";

/** One practice (reading, listening, writing or speaking): written the first time it is opened, then played. */
export default function PracticePage() {
  const { courseId, skill, practiceId } = useParams<{ courseId: string; skill: string; practiceId: string }>();
  const { data: course } = usePolyCourse(courseId);
  const { data: practice, error, refetch, isFetching } = usePractice(courseId, practiceId);
  const common = { courseId, practiceId, lang: course?.targetLang ?? "en" };
  const c = practice?.content as PlayerPracticeContent | null | undefined;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6 sm:px-6">
      <Link href={`/polylingue/${courseId}/practice/${skill}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> All {skill} practice
      </Link>
      {practice && <h1 className="text-xl font-semibold tracking-tight">{practice.title}</h1>}

      {error ? (
        <p className="text-sm text-destructive">{error.message}</p>
      ) : !practice || !course ? (
        <div className="h-64 animate-pulse rounded-lg bg-muted" />
      ) : practice.status === "FAILED" ? (
        <Card>
          <CardContent className="space-y-3 p-5 text-sm">
            <p className="text-destructive">This practice could not be written: {practice.error}</p>
            <Button onClick={() => void refetch()} disabled={isFetching}>
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : !c ? (
        <Card>
          <CardContent className="flex items-center gap-3 p-5 text-sm">
            <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
            Preparing your {skill} practice: the AI model is writing it (usually under a minute, then it is saved for next time).
          </CardContent>
        </Card>
      ) : c.skill === "READING" ? (
        <ReadingPlayer {...common} content={c} />
      ) : c.skill === "LISTENING" ? (
        <ListeningPlayer {...common} content={c} />
      ) : c.skill === "WRITING" ? (
        <WritingPlayer {...common} content={c} />
      ) : (
        <SpeakingPlayer {...common} content={c} />
      )}
    </div>
  );
}
