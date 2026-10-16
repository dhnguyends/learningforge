"use client";

import { useState } from "react";
import { ArrowRight, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { BASE_LANGUAGES, CEFR_LEVELS, LEVELS, TARGET_LANGUAGES, type Cefr } from "@/lib/polylingue/levels";
import { MAX_QUESTIONS, initialPlacement, nextQuestion, recordAnswer, suggestedLevel, type PlacementState } from "@/lib/polylingue/placement";
import { SpeakButtons } from "@/components/polylingue/speak";
import { LangBadge } from "@/components/polylingue/lang-badge";
import { usePlacementAnswer, usePlacementBank } from "@/hooks/use-polylingue";

/**
 * About 5 minutes, at most 12 questions, walking up and down the levels from
 * A2. It only suggests a level: the learner decides which one to study.
 */
export function PlacementTest({
  target: fixedTarget,
  base: fixedBase,
  onUse,
  onCancel,
}: {
  target?: string;
  base?: string;
  onUse: (level: Cefr, target: string, base: string) => void;
  onCancel: () => void;
}) {
  const [target, setTarget] = useState<string | null>(fixedTarget ?? null);
  const [base, setBase] = useState<string>(fixedBase && fixedBase !== fixedTarget ? fixedBase : fixedTarget === "en" ? "fr" : "en");
  const [started, setStarted] = useState(Boolean(fixedTarget));
  const { data: bank, error } = usePlacementBank(started ? target : null, started ? base : null);
  const check = usePlacementAnswer();
  const [state, setState] = useState<PlacementState>(initialPlacement);
  const [chosen, setChosen] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ correct: boolean; expected: string; explanation: string } | null>(null);

  if (!started) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">About 5 minutes: up to {MAX_QUESTIONS} questions that get harder or easier with your answers.</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {TARGET_LANGUAGES.map((l) => (
            <button
              key={l.code}
              type="button"
              onClick={() => {
                setTarget(l.code);
                if (base === l.code) setBase(l.code === "en" ? "fr" : "en");
              }}
              aria-pressed={target === l.code}
              className={cn("flex items-center gap-2 rounded-lg border p-3 text-left text-sm", target === l.code ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:bg-muted/50")}
            >
              <LangBadge code={l.code} size="sm" /> {l.name}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm">
          Questions explained in
          <select className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={base} onChange={(e) => setBase(e.target.value)}>
            {BASE_LANGUAGES.filter((l) => l.code !== target).map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex justify-between gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button disabled={!target} onClick={() => setStarted(true)} className="gap-1.5">
            Start the test <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
    );
  }

  if (error) return <p className="text-sm text-destructive">{error.message}</p>;
  if (!bank || !bank.items) {
    return bank?.status === "FAILED" ? (
      <p className="text-sm text-destructive">The test could not be prepared: {bank.error}</p>
    ) : (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Preparing the test (the first time for this language takes about a minute)…
      </p>
    );
  }

  const items = bank.items;
  const id = nextQuestion(state, items);
  if (state.done || id === null) {
    const level = suggestedLevel(state.answers);
    const byLevel = CEFR_LEVELS.map((l) => ({ l, at: state.answers.filter((a) => a.level === l) })).filter((x) => x.at.length > 0);
    return (
      <div className="space-y-4 text-center">
        <p className="text-sm text-muted-foreground">Suggested level</p>
        <p className="text-4xl font-bold text-primary">{level}</p>
        <p className="text-sm">
          {LEVELS[level].name}: {LEVELS[level].canDo}
        </p>
        <ul className="flex flex-wrap justify-center gap-2 text-xs text-muted-foreground">
          {byLevel.map(({ l, at }) => (
            <li key={l} className="rounded bg-muted px-2 py-1">
              {l}: {at.filter((a) => a.correct).length}/{at.length}
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">This is only a suggestion: you choose the level you study.</p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={() => onUse(level, target!, base)}>Use {level}</Button>
          <Button variant="outline" onClick={onCancel}>
            Choose myself
          </Button>
        </div>
      </div>
    );
  }

  const q = items[id];
  async function submit(answer: string) {
    try {
      const r = await check.mutateAsync({ target: target!, base, id: id!, answer });
      setFeedback(r);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not check");
    }
  }

  return (
    <div className="space-y-4">
      <Progress value={(state.answers.length / MAX_QUESTIONS) * 100} className="h-2" aria-label={`Question ${state.answers.length + 1}`} />
      <p className="text-base font-medium">{q.question}</p>
      {q.audio && <SpeakButtons key={id} lang={target!} text={q.audio} size="lg" autoPlay />}
      <div className="grid gap-2 sm:grid-cols-2">
        {q.options.map((o) => (
          <button
            key={o}
            type="button"
            disabled={Boolean(feedback) || check.isPending}
            onClick={() => {
              setChosen(o);
              void submit(o);
            }}
            className={cn(
              "rounded-lg border p-3 text-left text-sm transition-colors disabled:cursor-default",
              feedback && o === feedback.expected ? "border-emerald-500/60 bg-emerald-500/10" : chosen === o ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50",
            )}
          >
            {o}
          </button>
        ))}
      </div>
      {feedback && (
        <div className={cn("space-y-2 rounded-md border p-3 text-sm", feedback.correct ? "border-emerald-500/50 bg-emerald-500/10" : "border-red-500/50 bg-red-500/10")} role="status">
          <p className="flex items-center gap-2 font-medium">
            {feedback.correct ? <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" /> : <XCircle className="h-4 w-4 text-red-600" aria-hidden="true" />}
            {feedback.correct ? "Correct" : `Answer: ${feedback.expected}`}
          </p>
          {feedback.explanation && <p className="text-muted-foreground">{feedback.explanation}</p>}
          <Button
            className="w-full gap-1.5"
            autoFocus
            onClick={() => {
              setState((s) => recordAnswer(s, { id: id!, level: q.level, correct: feedback.correct }, items));
              setFeedback(null);
              setChosen(null);
            }}
          >
            Next <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      )}
    </div>
  );
}
