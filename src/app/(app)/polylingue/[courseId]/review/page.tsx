"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, Eye, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { SpeakButtons } from "@/components/polylingue/speak";
import { useGradeCard, usePolyCourse, useReviewCards } from "@/hooks/use-polylingue";

const GRADES = [
  { grade: 1, label: "Again", hint: "I didn't know it", className: "border-red-500/40 hover:bg-red-500/10" },
  { grade: 2, label: "Hard", hint: "With effort", className: "border-amber-500/40 hover:bg-amber-500/10" },
  { grade: 3, label: "Good", hint: "I knew it", className: "border-emerald-500/40 hover:bg-emerald-500/10" },
  { grade: 4, label: "Easy", hint: "Instantly", className: "border-sky-500/40 hover:bg-sky-500/10" },
] as const;

/**
 * Spaced review of the learner's words: the word (with audio) or its
 * translation, then the answer; the grade schedules the next review (FSRS),
 * just before the word would be forgotten.
 */
export default function PolyReviewPage() {
  const { courseId } = useParams<{ courseId: string }>();
  const { data: course } = usePolyCourse(courseId);
  const { data, isLoading, error } = useReviewCards(courseId);
  const grade = useGradeCard(courseId);
  const [pos, setPos] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [xp, setXp] = useState(0);
  const shownAt = useRef(Date.now());

  const cards = data?.cards ?? [];
  const card = cards[pos];
  const lang = course?.targetLang ?? "en";
  // Alternate directions: the word first, then its meaning first.
  const fromTarget = pos % 2 === 0 || card?.state === "NEW";

  async function onGrade(g: 1 | 2 | 3 | 4) {
    if (!card) return;
    try {
      const r = await grade.mutateAsync({ cardId: card.id, grade: g, seconds: (Date.now() - shownAt.current) / 1000 });
      setXp((x) => x + r.xp);
      setRevealed(false);
      setPos((p) => p + 1);
      shownAt.current = Date.now();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    }
  }

  return (
    <div className="mx-auto w-full max-w-xl space-y-4 px-4 py-6 sm:px-6">
      <Link href={`/polylingue/${courseId}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to the course
      </Link>
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Review</h1>
        {cards.length > 0 && <Progress value={(Math.min(pos, cards.length) / cards.length) * 100} className="h-2 flex-1" />}
        <span className="inline-flex items-center gap-1 text-sm font-semibold tabular-nums text-amber-600">
          <Sparkles className="h-4 w-4" aria-hidden="true" /> {xp}
        </span>
      </div>

      {error ? (
        <p className="text-sm text-destructive">{error.message}</p>
      ) : isLoading ? (
        <div className="h-48 animate-pulse rounded-lg bg-muted" />
      ) : !card ? (
        <Card>
          <CardContent className="space-y-3 p-6 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" aria-hidden="true" />
            <p className="font-semibold">{cards.length ? `Done: ${cards.length} words reviewed, +${xp} XP` : "Nothing to review right now"}</p>
            <p className="text-sm text-muted-foreground">Words come back just before you would forget them. Finish a lesson to add new ones.</p>
            <Button asChild>
              <Link href={`/polylingue/${courseId}`}>Back to the course</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="space-y-5 p-6 text-center">
            <p className="text-xs text-muted-foreground">
              {pos + 1} / {cards.length}
              {card.partOfSpeech ? ` · ${card.partOfSpeech}` : ""}
            </p>
            {fromTarget ? (
              <div className="space-y-2">
                <p className="text-3xl font-semibold">{card.term}</p>
                <SpeakButtons lang={lang} text={card.term} autoPlay />
              </div>
            ) : (
              <p className="text-2xl font-semibold">{card.translation}</p>
            )}

            {revealed ? (
              <div className="space-y-2 border-t border-border pt-4">
                {fromTarget ? (
                  <p className="text-xl">{card.translation}</p>
                ) : (
                  <div className="space-y-2">
                    <p className="text-2xl font-semibold">{card.term}</p>
                    <SpeakButtons lang={lang} text={card.term} autoPlay />
                  </div>
                )}
                {card.example && (
                  <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                    <span>
                      <span className="italic text-foreground/80">{card.example}</span>
                      {card.exampleTranslation ? ` · ${card.exampleTranslation}` : ""}
                    </span>
                    <SpeakButtons lang={lang} text={card.example} size="sm" />
                  </p>
                )}
                <div className="grid grid-cols-2 gap-2 pt-2 sm:grid-cols-4">
                  {GRADES.map((g) => (
                    <button
                      key={g.grade}
                      type="button"
                      onClick={() => void onGrade(g.grade)}
                      disabled={grade.isPending}
                      className={`rounded-lg border p-2 text-sm transition-colors ${g.className}`}
                    >
                      <span className="block font-semibold">{g.label}</span>
                      <span className="block text-[11px] text-muted-foreground">{g.hint}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <Button size="lg" className="w-full gap-1.5" onClick={() => setRevealed(true)} autoFocus>
                <Eye className="h-4 w-4" aria-hidden="true" /> Show the answer
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
