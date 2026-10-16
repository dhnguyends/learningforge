"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowRight, CheckCircle2, Loader2, Sparkles, Target, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { SpeakButtons } from "@/components/polylingue/speak";
import { usePolyCourse, useWeakAnswer, useWeakSession } from "@/hooks/use-polylingue";
import type { Verdict } from "@/lib/polylingue/check";

/**
 * Practise weak words: the words you forget or miss most, asked three ways
 * (recognise, hear, write). Every answer reschedules the word's review.
 */
export default function WeakWordsPage() {
  const { courseId } = useParams<{ courseId: string }>();
  const { data: course } = usePolyCourse(courseId);
  const { data, isLoading, error, refetch } = useWeakSession(courseId);
  const answer = useWeakAnswer(courseId);
  const [pos, setPos] = useState(0);
  const [chosen, setChosen] = useState("");
  const [result, setResult] = useState<{ verdict: Verdict; expected: string; note?: string; xp: number; term: string; translation: string } | null>(null);
  const [xp, setXp] = useState(0);
  const [right, setRight] = useState(0);
  const lang = course?.targetLang ?? "en";
  const ex = data?.exercises[pos];

  async function check(given: string) {
    if (!ex || !given.trim()) return;
    try {
      const r = await answer.mutateAsync({ cardId: ex.cardId, kind: ex.kind, answer: given });
      setResult(r);
      setXp((x) => x + r.xp);
      if (r.verdict !== "wrong") setRight((n) => n + 1);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not check");
    }
  }

  function next() {
    setResult(null);
    setChosen("");
    setPos((p) => p + 1);
  }

  return (
    <div className="mx-auto w-full max-w-xl space-y-4 px-4 py-6 sm:px-6">
      <div className="flex items-center gap-3">
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <Target className="h-5 w-5 text-primary" aria-hidden="true" /> Weak words
        </h1>
        {data?.enough && <Progress value={(pos / data.exercises.length) * 100} className="h-2 flex-1" />}
        <span className="inline-flex items-center gap-1 text-sm font-semibold tabular-nums text-amber-600">
          <Sparkles className="h-4 w-4" aria-hidden="true" /> {xp}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">The words you forget or miss most, from your own lessons, at your level. Each answer reschedules the word&apos;s review.</p>

      {error ? (
        <p className="text-sm text-destructive">{error.message}</p>
      ) : isLoading || !data ? (
        <div className="h-48 animate-pulse rounded-lg bg-muted" />
      ) : !data.enough ? (
        <Card>
          <CardContent className="space-y-3 p-6 text-center text-sm">
            <p>Finish a lesson or two first: this practice needs at least 4 of your words.</p>
            <Button asChild>
              <Link href={`/polylingue/${courseId}`}>Go to the lessons</Link>
            </Button>
          </CardContent>
        </Card>
      ) : !ex ? (
        <Card>
          <CardContent className="space-y-3 p-6 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" aria-hidden="true" />
            <p className="font-semibold">
              {right} / {data.exercises.length} right · +{xp} XP
            </p>
            <div className="flex justify-center gap-2">
              <Button
                onClick={() => {
                  setPos(0);
                  setXp(0);
                  setRight(0);
                  void refetch();
                }}
              >
                Another round
              </Button>
              <Button asChild variant="outline">
                <Link href={`/polylingue/${courseId}`}>Back to the course</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="space-y-4 p-5">
            {ex.kind === "choose" && (
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">What does it mean?</p>
                <p className="flex items-center gap-2 text-2xl font-semibold">
                  {ex.shown} <SpeakButtons lang={lang} text={ex.audio} size="sm" />
                </p>
              </div>
            )}
            {ex.kind === "listen" && (
              <div className="space-y-2 text-center">
                <p className="text-sm text-muted-foreground">Listen: what does it mean?</p>
                <SpeakButtons key={pos} lang={lang} text={ex.audio} size="lg" autoPlay />
              </div>
            )}
            {ex.kind === "type" && (
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Write the word for:</p>
                <p className="text-2xl font-semibold">{ex.shown}</p>
              </div>
            )}

            {ex.kind === "type" ? (
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void check(chosen);
                }}
              >
                <Input autoFocus value={chosen} onChange={(e) => setChosen(e.target.value)} disabled={Boolean(result)} placeholder="Type the word" autoComplete="off" spellCheck={false} className="h-11" />
                {!result && (
                  <Button type="submit" disabled={!chosen.trim() || answer.isPending}>
                    Check
                  </Button>
                )}
              </form>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {ex.options.map((o) => (
                  <button
                    key={o}
                    type="button"
                    disabled={Boolean(result) || answer.isPending}
                    onClick={() => {
                      setChosen(o);
                      void check(o);
                    }}
                    className={cn(
                      "rounded-lg border p-3 text-left text-sm transition-colors disabled:cursor-default",
                      result && o === result.expected ? "border-emerald-500/60 bg-emerald-500/10" : chosen === o ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50",
                    )}
                  >
                    {o}
                  </button>
                ))}
              </div>
            )}

            {answer.isPending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />}
            {result && (
              <div
                className={cn("space-y-2 rounded-md border p-3 text-sm", result.verdict === "correct" ? "border-emerald-500/50 bg-emerald-500/10" : result.verdict === "almost" ? "border-amber-500/50 bg-amber-500/10" : "border-red-500/50 bg-red-500/10")}
                role="status"
              >
                <p className="flex items-center gap-2 font-medium">
                  {result.verdict === "wrong" ? <XCircle className="h-4 w-4 text-red-600" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />}
                  {result.verdict === "correct" ? "Correct" : result.verdict === "almost" ? `Almost${result.note ? `: ${result.note}` : ""}` : "Not quite"}
                  {result.xp > 0 && <span className="ml-auto text-xs text-amber-600">+{result.xp} XP</span>}
                </p>
                <p className="flex items-center gap-2">
                  <SpeakButtons lang={lang} text={result.term} size="sm" />
                  <span className="font-semibold">{result.term}</span> = {result.translation}
                </p>
                <Button onClick={next} className="w-full gap-1.5" autoFocus>
                  Continue <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
