"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, BookMarked, CheckCircle2, Lightbulb, Loader2, RotateCcw, Sparkles, Trophy, X, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { SpeakButtons, useSpeak } from "@/components/polylingue/speak";
import { useAnswer, useCompleteLesson, useHint, type AnswerResult, type PlayerLesson } from "@/hooks/use-polylingue";
import type { Exercise, LessonWord } from "@/lib/polylingue/content";
import { flushOutbox, offlineRun } from "@/lib/polylingue/pwa-client";
import type { PlayerExercise } from "@/lib/polylingue/content";
import { MODE_LABELS, type AdaptedFields } from "@/lib/polylingue/adapt";

/** Deterministic shuffle (same order on every render of the same exercise). */
function shuffle<T>(items: T[], seed: number): T[] {
  const out = [...items];
  let s = seed * 9301 + 49297;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

interface QueueItem {
  index: number;
  retry: boolean;
}

/**
 * The lesson: intro and new words, then 10–15 exercises with instant
 * correction; a missed exercise comes back once at the end. Finishing records
 * the score, time and XP, and puts the lesson's words into review.
 */
export function LessonPlayer({
  courseId,
  lang,
  lesson,
  nextHref,
  grammar,
  offlineExercises,
}: {
  courseId: string;
  lang: string;
  lesson: PlayerLesson;
  nextHref: string;
  /** Grammar focus of the lesson's unit, shown in the intro. */
  grammar?: string;
  /** Played offline: the lesson's exercises with their answers, corrected here and sent later. */
  offlineExercises?: Exercise[];
}) {
  const content = lesson.content!;
  const total = content.exercises.length;
  const answer = useAnswer(courseId, lesson.id);
  const hintQuery = useHint(courseId, lesson.id);
  const [hint, setHint] = useState<string | null>(null);
  const complete = useCompleteLesson(courseId, lesson.id);
  const [started, setStarted] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>(() => content.exercises.map((_, index) => ({ index, retry: false })));
  const [pos, setPos] = useState(0);
  const [result, setResult] = useState<AnswerResult | null>(null);
  const [firstTryCorrect, setFirstTryCorrect] = useState(0);
  const [xp, setXp] = useState(0);
  const [summary, setSummary] = useState<{ score: number; bonusXp: number; newWords: number } | null>(null);
  const startedAt = useRef<number>(Date.now());
  const offlineRunRef = useRef<ReturnType<typeof offlineRun> | null>(null);
  const run = () => {
    if (!offlineExercises) return null;
    offlineRunRef.current ??= offlineRun(courseId, lesson.id, offlineExercises);
    return offlineRunRef.current;
  };

  /** Back to the start of the lesson (its intro); XP already earned is kept. */
  function restart() {
    setQueue(content.exercises.map((_, index) => ({ index, retry: false })));
    setPos(0);
    setResult(null);
    setFirstTryCorrect(0);
    setXp(0);
    setSummary(null);
    setStarted(false);
    startedAt.current = Date.now();
    offlineRunRef.current = null;
  }

  const item = queue[pos];
  const exercise = item ? content.exercises[item.index] : null;
  const answeredFirstPass = Math.min(total, queue.slice(0, pos + (result ? 1 : 0)).filter((q) => !q.retry).length);

  async function submit(given: string) {
    if (!item || result || answer.isPending) return;
    try {
      const input = { index: item.index, answer: given, retry: item.retry, hinted: Boolean(hint) };
      const r = run()?.answer(input) ?? (await answer.mutateAsync(input));
      setResult(r);
      setXp((x) => x + r.xp);
      if (!item.retry && r.verdict !== "wrong") setFirstTryCorrect((n) => n + 1);
      if (!item.retry && r.verdict === "wrong") setQueue((q) => [...q, { index: item.index, retry: true }]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not check the answer");
    }
  }

  async function showHint() {
    if (!item || hint) return;
    if (offlineExercises) return void toast.info("Hints need a connection.");
    try {
      setHint((await hintQuery.mutateAsync(item.index)).hint);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No hint available");
    }
  }

  async function next() {
    setResult(null);
    setHint(null);
    if (pos + 1 < queue.length) {
      setPos((p) => p + 1);
      return;
    }
    try {
      const input = { firstTryCorrect, total, seconds: (Date.now() - startedAt.current) / 1000 };
      const offline = run();
      const s = offline ? offline.complete(input) : await complete.mutateAsync(input);
      setSummary(s);
      // Back online already: send it now.
      if (offline && navigator.onLine) void flushOutbox();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the lesson");
    }
  }

  if (summary) {
    return (
      <Card>
        <CardContent className="space-y-4 p-6 text-center">
          <Trophy className="mx-auto h-12 w-12 text-amber-500" aria-hidden="true" />
          <h2 className="text-xl font-semibold">Lesson complete!</h2>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <Stat label="Score" value={`${summary.score}%`} />
            <Stat label="XP earned" value={`+${xp + summary.bonusXp}`} />
            <Stat label="New words" value={String(summary.newWords)} />
          </div>
          <p className="text-sm text-muted-foreground">
            {summary.score === 100 ? "Perfect lesson: bonus XP! " : ""}
            {offlineExercises
              ? "Saved on this device: your XP and the lesson's words are added when you are back online."
              : "The new words are in your review."}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button asChild className="gap-1.5">
              <Link href={nextHref}>
                Continue <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/polylingue/${courseId}/review`}>Review words</Link>
            </Button>
            <Button variant="ghost" onClick={restart} className="gap-1.5">
              <RotateCcw className="h-4 w-4" aria-hidden="true" /> Do it again
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!started) {
    return (
      <Card>
        <CardContent className="space-y-4 p-5">
          <p className="text-sm leading-relaxed">{content.intro}</p>
          {grammar && (
            <p className="flex gap-2 rounded-md bg-primary/5 p-3 text-sm">
              <BookMarked className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <span>
                <span className="font-medium">Grammar focus of this unit:</span> {grammar}
              </span>
            </p>
          )}
          <div>
            <h3 className="mb-2 text-sm font-semibold">New words</h3>
            <ul className="divide-y divide-border/60 rounded-md border border-border">
              {content.words.map((w) => (
                <li key={w.term} className="flex items-start gap-3 p-3">
                  <SpeakButtons lang={lang} text={w.term} size="sm" />
                  <div className="min-w-0 flex-1 text-sm">
                    <p>
                      <span className="font-semibold">{w.term}</span> <span className="text-muted-foreground">· {w.translation}</span>
                      {w.partOfSpeech && <span className="ml-1 text-xs text-muted-foreground">({w.partOfSpeech})</span>}
                    </p>
                    {w.example && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        <span className="italic text-foreground/80">{w.example}</span> {w.exampleTranslation && `· ${w.exampleTranslation}`}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <Button
            size="lg"
            className="w-full gap-1.5"
            onClick={() => {
              startedAt.current = Date.now();
              setStarted(true);
            }}
          >
            Start the {total} exercises <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!exercise || !item) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link href={`/polylingue/${courseId}`} className="text-muted-foreground hover:text-foreground" aria-label="Leave the lesson">
          <X className="h-5 w-5" aria-hidden="true" />
        </Link>
        <Progress value={(answeredFirstPass / total) * 100} className="h-3 flex-1" aria-label={`${answeredFirstPass} of ${total} exercises`} />
        <button
          type="button"
          onClick={restart}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Restart the lesson from the start"
          title="Restart the lesson from the start"
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
        </button>
        <span className="inline-flex items-center gap-1 text-sm font-semibold tabular-nums text-amber-600">
          <Sparkles className="h-4 w-4" aria-hidden="true" /> {xp}
        </span>
      </div>
      {lesson.mode !== "normal" && (
        <p className="text-xs text-muted-foreground" title={MODE_LABELS[lesson.mode].description}>
          <span className={cn("mr-1 rounded px-1.5 py-0.5 font-medium", lesson.mode === "challenge" ? "bg-violet-500/15 text-violet-700 dark:text-violet-300" : "bg-sky-500/15 text-sky-700 dark:text-sky-300")}>
            {MODE_LABELS[lesson.mode].label} mode
          </span>
          {MODE_LABELS[lesson.mode].description}
        </p>
      )}
      {item.retry && <p className="text-xs font-medium text-amber-600">Let&apos;s try this one again</p>}

      <Card>
        <CardContent className="space-y-4 p-5">
          <ExerciseView
            key={`${pos}-${item.index}`}
            exercise={exercise}
            seed={item.index + 1}
            lang={lang}
            locked={Boolean(result)}
            pending={answer.isPending}
            onSubmit={(given) => void submit(given)}
            words={content.words.filter((w) => exercise.glossable.includes(w.term))}
          />
          {!result &&
            (hint ? (
              <p className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm" role="status">
                <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" /> {hint}
              </p>
            ) : (
              <button
                type="button"
                onClick={() => void showHint()}
                disabled={hintQuery.isPending}
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                title="A clue without the answer (half the XP for this exercise)"
              >
                {hintQuery.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Lightbulb className="h-3.5 w-3.5" aria-hidden="true" />}
                Hint (½ XP)
              </button>
            ))}
        </CardContent>
      </Card>

      {result && <Feedback result={result} lang={lang} onNext={() => void next()} last={pos + 1 >= queue.length} saving={complete.isPending} />}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/50 p-3">
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function Feedback({ result, lang, onNext, last, saving }: { result: AnswerResult; lang: string; onNext: () => void; last: boolean; saving: boolean }) {
  const tone =
    result.verdict === "correct"
      ? "border-emerald-500/50 bg-emerald-500/10"
      : result.verdict === "almost"
        ? "border-amber-500/50 bg-amber-500/10"
        : "border-red-500/50 bg-red-500/10";
  return (
    <div className={cn("space-y-2 rounded-lg border p-4", tone)} role="status" aria-live="polite">
      <p className="flex items-center gap-2 font-semibold">
        {result.verdict === "correct" ? (
          <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden="true" />
        ) : result.verdict === "almost" ? (
          <CheckCircle2 className="h-5 w-5 text-amber-600" aria-hidden="true" />
        ) : (
          <XCircle className="h-5 w-5 text-red-600" aria-hidden="true" />
        )}
        {result.verdict === "correct" ? "Correct!" : result.verdict === "almost" ? `Almost${result.note ? `: ${result.note}` : ""}` : "Not quite"}
        {result.xp > 0 && <span className="ml-auto text-sm text-amber-600">+{result.xp} XP</span>}
      </p>
      {result.verdict !== "correct" && (
        <p className="text-sm">
          Correct answer: <span className="font-semibold">{result.expected}</span>
        </p>
      )}
      {result.explanation && <p className="text-sm text-muted-foreground">{result.explanation}</p>}
      <div className="flex items-center justify-between gap-2 pt-1">
        {result.audio ? <SpeakButtons lang={lang} text={result.audio} size="sm" /> : <span />}
        <Button onClick={onNext} disabled={saving} className="gap-1.5" autoFocus>
          {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {last ? "Finish" : "Continue"} <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

/** One exercise; calls onSubmit(answer) once. */
function ExerciseView({
  exercise: e,
  seed,
  lang,
  locked,
  pending,
  onSubmit,
  words = [],
}: {
  exercise: PlayerExercise & AdaptedFields;
  seed: number;
  lang: string;
  locked: boolean;
  pending: boolean;
  onSubmit: (answer: string) => void;
  words?: LessonWord[];
}) {
  const [gloss, setGloss] = useState<LessonWord | null>(null);
  return (
    <div className="space-y-4">
      <p className="text-base font-medium">
        <Glossed text={e.prompt} words={words} onWord={setGloss} />
      </p>
      {e.type === "listen" ? (
        <div className="flex justify-center py-2">
          <SpeakButtons lang={lang} text={e.audio} size="lg" autoPlay autoPlaySlow={e.slowFirst} />
        </div>
      ) : (
        e.audio &&
        e.type !== "order" &&
        e.type !== "cloze" && (
          <div className="flex items-center gap-2">
            <SpeakButtons lang={lang} text={e.audio} size="sm" />
          </div>
        )
      )}
      {e.type === "cloze" && (
        <p className="rounded-md bg-muted/50 p-3 text-lg">
          <Glossed text={e.text} words={words} onWord={setGloss} />
        </p>
      )}
      {gloss && (
        <p className="flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 p-2 text-sm" role="status">
          <SpeakButtons lang={lang} text={gloss.term} size="sm" />
          <span className="font-semibold">{gloss.term}</span>
          <span className="text-muted-foreground">
            · {gloss.translation}
            {gloss.partOfSpeech ? ` (${gloss.partOfSpeech})` : ""}
          </span>
          {gloss.example && <span className="w-full text-xs italic text-muted-foreground">{gloss.example}</span>}
        </p>
      )}
      {e.input === "options" ? (
        <Choices options={e.options} seed={seed} locked={locked} pending={pending} onSubmit={onSubmit} />
      ) : e.input === "match" ? (
        <MatchPairs pairs={e.pairs} seed={seed} lang={lang} locked={locked} onDone={(mistakes) => onSubmit(String(mistakes))} />
      ) : e.input === "order" ? (
        <WordOrder tokens={e.tokens} seed={seed} locked={locked} pending={pending} onSubmit={onSubmit} />
      ) : e.input === "wordbank" ? (
        <>
          <p className="text-xs text-muted-foreground">Build your answer with the words below (some are extra).</p>
          <WordOrder tokens={e.wordBank} seed={seed} locked={locked} pending={pending} onSubmit={onSubmit} requireAll={false} />
        </>
      ) : (
        <TypeAnswer locked={locked} pending={pending} onSubmit={onSubmit} />
      )}
    </div>
  );
}

function Choices({ options, seed, locked, pending, onSubmit }: { options: string[]; seed: number; locked: boolean; pending: boolean; onSubmit: (a: string) => void }) {
  const shuffled = useMemo(() => shuffle(options, seed), [options, seed]);
  const [chosen, setChosen] = useState<string | null>(null);
  useEffect(() => {
    if (locked) return;
    const onKey = (ev: KeyboardEvent) => {
      const n = Number(ev.key);
      if (n >= 1 && n <= shuffled.length) setChosen(shuffled[n - 1]);
      if (ev.key === "Enter" && chosen) onSubmit(chosen);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [locked, shuffled, chosen, onSubmit]);
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {shuffled.map((o, i) => (
          <button
            key={o}
            type="button"
            disabled={locked}
            onClick={() => setChosen(o)}
            className={cn(
              "flex items-center gap-2 rounded-lg border p-3 text-left text-sm transition-colors disabled:cursor-default",
              chosen === o ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:bg-muted/50",
            )}
          >
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[10px] text-muted-foreground">{i + 1}</span>
            {o}
          </button>
        ))}
      </div>
      {!locked && (
        <Button className="w-full" size="lg" disabled={!chosen || pending} onClick={() => chosen && onSubmit(chosen)}>
          {pending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
          Check
        </Button>
      )}
    </div>
  );
}

function TypeAnswer({ locked, pending, onSubmit }: { locked: boolean; pending: boolean; onSubmit: (a: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <form
      className="space-y-3"
      onSubmit={(ev) => {
        ev.preventDefault();
        if (value.trim()) onSubmit(value);
      }}
    >
      <Input
        autoFocus
        value={value}
        onChange={(ev) => setValue(ev.target.value)}
        disabled={locked}
        placeholder="Type your answer"
        aria-label="Your answer"
        className="h-12 text-base"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
      />
      {!locked && (
        <Button type="submit" className="w-full" size="lg" disabled={!value.trim() || pending}>
          {pending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
          Check
        </Button>
      )}
    </form>
  );
}

function WordOrder({
  tokens,
  seed,
  locked,
  pending,
  onSubmit,
  requireAll = true,
}: {
  tokens: string[];
  seed: number;
  locked: boolean;
  pending: boolean;
  onSubmit: (a: string) => void;
  /** Word order uses every word; a word bank may hold extra words. */
  requireAll?: boolean;
}) {
  const bank = useMemo(() => shuffle(tokens.map((t, i) => ({ t, i })), seed), [tokens, seed]);
  const [picked, setPicked] = useState<number[]>([]);
  const sentence = picked.map((i) => tokens[i]).join(" ");
  return (
    <div className="space-y-3">
      <div className="flex min-h-[3rem] flex-wrap gap-2 rounded-lg border border-dashed border-border p-2" aria-label="Your sentence">
        {picked.map((i, k) => (
          <button
            key={`${i}-${k}`}
            type="button"
            disabled={locked}
            onClick={() => setPicked((p) => p.filter((_, j) => j !== k))}
            className="rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-sm"
          >
            {tokens[i]}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {bank.map(({ t, i }) => (
          <button
            key={i}
            type="button"
            disabled={locked || picked.includes(i)}
            onClick={() => setPicked((p) => [...p, i])}
            className="rounded-md border border-border px-2.5 py-1.5 text-sm transition-opacity hover:bg-muted/50 disabled:opacity-30"
          >
            {t}
          </button>
        ))}
      </div>
      {!locked && (
        <div className="flex gap-2">
          <Button variant="outline" size="lg" onClick={() => setPicked([])} disabled={!picked.length} aria-label="Start again">
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button className="flex-1" size="lg" disabled={(requireAll ? picked.length !== tokens.length : picked.length === 0) || pending} onClick={() => onSubmit(sentence)}>
            {pending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
            Check
          </Button>
        </div>
      )}
    </div>
  );
}

function MatchPairs({
  pairs,
  seed,
  lang,
  locked,
  onDone,
}: {
  pairs: { left: string; right: string }[];
  seed: number;
  lang: string;
  locked: boolean;
  onDone: (mistakes: number) => void;
}) {
  const lefts = useMemo(() => shuffle(pairs.map((p) => p.left), seed), [pairs, seed]);
  const rights = useMemo(() => shuffle(pairs.map((p) => p.right), seed + 7), [pairs, seed]);
  const [left, setLeft] = useState<string | null>(null);
  const [matched, setMatched] = useState<string[]>([]);
  const [wrong, setWrong] = useState<string | null>(null);
  const [mistakes, setMistakes] = useState(0);
  const { speak } = useSpeak(lang);
  const done = useRef(false);

  function pickRight(r: string) {
    if (!left || locked) return;
    const ok = pairs.some((p) => p.left === left && p.right === r);
    if (ok) {
      const next = [...matched, left];
      setMatched(next);
      setLeft(null);
      if (next.length === pairs.length && !done.current) {
        done.current = true;
        onDone(mistakes);
      }
    } else {
      setMistakes((m) => m + 1);
      setWrong(r);
      setTimeout(() => setWrong(null), 500);
    }
  }

  const rightDone = (r: string) => pairs.some((p) => p.right === r && matched.includes(p.left));
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="space-y-2">
        {lefts.map((l) => (
          <button
            key={l}
            type="button"
            disabled={locked || matched.includes(l)}
            onClick={() => {
              setLeft(l);
              void speak(l);
            }}
            className={cn(
              "w-full rounded-lg border p-3 text-left text-sm transition-colors disabled:opacity-40",
              left === l ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:bg-muted/50",
              matched.includes(l) && "border-emerald-500/50 bg-emerald-500/10",
            )}
          >
            {l}
          </button>
        ))}
      </div>
      <div className="space-y-2">
        {rights.map((r) => (
          <button
            key={r}
            type="button"
            disabled={locked || rightDone(r)}
            onClick={() => pickRight(r)}
            className={cn(
              "w-full rounded-lg border p-3 text-left text-sm transition-colors disabled:opacity-40",
              wrong === r ? "border-red-500 bg-red-500/10" : "border-border hover:bg-muted/50",
              rightDone(r) && "border-emerald-500/50 bg-emerald-500/10",
            )}
          >
            {r}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Text with the lesson's words underlined: a tap shows the word's meaning (no answer is ever glossed). */
function Glossed({ text, words, onWord }: { text: string; words: LessonWord[]; onWord: (w: LessonWord) => void }) {
  const parts = useMemo(() => {
    const terms = [...words].filter((w) => w.term.length > 1).sort((a, b) => b.term.length - a.term.length);
    if (!terms.length || !text) return [{ text }];
    const re = new RegExp(`(${terms.map((t) => t.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "giu");
    return text.split(re).map((piece) => {
      const w = terms.find((t) => t.term.toLowerCase() === piece.toLowerCase());
      return w ? { text: piece, word: w } : { text: piece };
    });
  }, [text, words]);
  return (
    <>
      {parts.map((p, i) =>
        "word" in p && p.word ? (
          <button
            key={i}
            type="button"
            onClick={() => onWord(p.word!)}
            className="rounded underline decoration-primary/50 decoration-dotted underline-offset-4 hover:bg-primary/10"
          >
            {p.text}
          </button>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}
