"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { ArrowDown, ArrowUp, CheckCircle2, HelpCircle, Loader2, Plus, RotateCcw, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Markdown } from "@/components/shared/markdown";
import { CitationList, type AnchorData } from "@/components/shared/citation-chip";
import {
  useQuizzes,
  useQuiz,
  useGenerateQuiz,
  useSubmitQuizAttempt,
  type QuizRow,
  type AnchorRef,
  type QuizAttemptResult,
} from "@/hooks/use-api";
import { cn } from "@/lib/utils";

const QUESTION_TYPES: { value: string; label: string }[] = [
  { value: "multiple_choice", label: "Multiple choice" },
  { value: "multi_select", label: "Multi-select" },
  { value: "short_answer", label: "Short answer" },
  { value: "ordering", label: "Ordering" },
  { value: "matching", label: "Matching" },
  { value: "derivation_steps", label: "Derivation steps" },
  { value: "code_tracing", label: "Code tracing" },
  { value: "numerical", label: "Numerical" },
];

type Response = { selectedIds?: string[]; text?: string; numeric?: number; order?: string[]; pairs?: Record<string, string>; skipped?: boolean };

export default function QuizPage() {
  const { studySetId } = useParams<{ studySetId: string }>();
  const { data, isLoading } = useQuizzes(studySetId);
  const generate = useGenerateQuiz(studySetId);
  const [takingId, setTakingId] = useState<string | null>(null);
  const [genOpen, setGenOpen] = useState(false);
  const [count, setCount] = useState(8);
  const [difficulty, setDifficulty] = useState("adaptive");
  const [types, setTypes] = useState<string[]>([]);

  async function onGenerate() {
    try {
      const res = await generate.mutateAsync({
        count,
        difficulty,
        ...(types.length > 0 ? { types } : {}),
      });
      toast.success(
        res.adaptiveReason ? `Quiz generating — ${res.adaptiveReason}` : "Quiz generating",
      );
      setGenOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start generation");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Quizzes</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Graded server-side — answers stay hidden until you submit. Distractors explain why they&apos;re wrong.
          </p>
        </div>
        <Button onClick={() => setGenOpen(true)} disabled={generate.isPending}>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> Generate quiz
        </Button>
      </div>

      {isLoading ? (
        <div className="h-32 animate-pulse rounded-lg bg-muted" />
      ) : (data?.quizzes ?? []).length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="rounded-full bg-primary/10 p-3 text-primary"><HelpCircle className="h-6 w-6" aria-hidden="true" /></div>
            <div>
              <p className="font-medium">No quizzes yet</p>
              <p className="mt-1 text-sm text-muted-foreground">Generate an adaptive quiz from your indexed sources.</p>
            </div>
            <Button onClick={() => setGenOpen(true)}>Generate quiz</Button>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {(data?.quizzes ?? []).map((q) => (
            <li key={q.id}>
              <div className="flex items-center gap-3 rounded-lg border border-border px-4 py-3 transition-colors hover:border-primary/40">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{q.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {q.status}
                    {q.config && typeof q.config === "object" && "difficulty" in (q.config as object)
                      ? ` · ${(q.config as { difficulty?: string }).difficulty}`
                      : ""}
                  </p>
                </div>
                <Button size="sm" variant={q.status === "READY" ? "default" : "outline"} disabled={q.status !== "READY"} onClick={() => setTakingId(q.id)}>
                  {q.status === "READY" ? "Take quiz" : q.status === "GENERATING" ? "Generating…" : q.status}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={genOpen} onOpenChange={setGenOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate a quiz</DialogTitle>
            <DialogDescription>Questions are validated for ambiguity before they reach you.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="q-count">Questions: {count}</Label>
                <input id="q-count" type="range" min={3} max={30} value={count} onChange={(e) => setCount(Number(e.target.value))} className="w-full accent-[hsl(var(--primary))]" />
              </div>
              <div className="space-y-1.5">
                <Label>Difficulty</Label>
                <Select value={difficulty} onValueChange={setDifficulty}>
                  <SelectTrigger aria-label="Difficulty"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="adaptive">Adaptive (from your mastery)</SelectItem>
                    <SelectItem value="easy">Easy</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="hard">Hard</SelectItem>
                    <SelectItem value="advanced">Advanced</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Question types (empty = mix)</Label>
              <div className="flex flex-wrap gap-1.5">
                {QUESTION_TYPES.map((t) => {
                  const active = types.includes(t.value);
                  return (
                    <button
                      key={t.value}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setTypes((prev) => (active ? prev.filter((x) => x !== t.value) : [...prev, t.value]))}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-xs transition-colors",
                        active ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40",
                      )}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setGenOpen(false)}>Cancel</Button>
            <Button onClick={() => void onGenerate()} disabled={generate.isPending}>
              {generate.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              Generate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {takingId && <QuizRunner studySetId={studySetId} quizId={takingId} onExit={() => setTakingId(null)} />}
    </div>
  );
}

/* --------------------------------- runner ---------------------------------- */

function anchorsFrom(refs: AnchorRef[] | undefined): AnchorData[] {
  return (refs ?? []).map((a) => ({
    id: a.id,
    sourceId: a.sourceId,
    sourceTitle: a.source?.title ?? "Source",
    sourceType: a.source?.type ?? "",
    startMs: a.startMs,
    endMs: a.endMs,
    page: a.page,
    excerpt: a.excerpt,
  }));
}

function QuizRunner({ studySetId, quizId, onExit }: { studySetId: string; quizId: string; onExit: () => void }) {
  const { data, isLoading } = useQuiz(quizId);
  const submit = useSubmitQuizAttempt(studySetId);
  const [answers, setAnswers] = useState<Record<string, Response>>({});
  const [result, setResult] = useState<QuizAttemptResult | null>(null);
  const [seeded, setSeeded] = useState(false);
  const startedAt = useMemo(() => Date.now(), []);

  const quiz = data?.quiz;
  // Stable identity: the seeding effect below depends on this array.
  const questions = useMemo(() => quiz?.questions ?? [], [quiz]);

  // Seed ordering questions with a shuffled initial order (stored order would leak the answer).
  useEffect(() => {
    if (seeded || questions.length === 0) return;
    const initial: Record<string, Response> = {};
    for (const q of questions) {
      const t = q.type.toUpperCase();
      if (t === "ORDERING" || t === "DERIVATION_STEPS") {
        const ids = (q.options ?? []).map((o) => o.id);
        for (let i = ids.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [ids[i], ids[j]] = [ids[j], ids[i]];
        }
        initial[q.id] = { order: ids };
      }
    }
    if (Object.keys(initial).length > 0) setAnswers((prev) => ({ ...initial, ...prev }));
    setSeeded(true);
  }, [questions, seeded]);

  async function onSubmit() {
    if (!quiz) return;
    // Wire format is flat per question ({ questionId, selectedIds, ... }) —
    // nesting under `answer` gets stripped by the route's zod schema and
    // everything grades as skipped.
    const payload = questions.map((q) => ({ questionId: q.id, ...(answers[q.id] ?? { skipped: true }) }));
    try {
      const res = await submit.mutateAsync({ quizId: quiz.id, answers: payload });
      setResult(res);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Submit failed");
    }
  }

  if (isLoading || !quiz) return <div className="h-64 animate-pulse rounded-lg bg-muted" />;

  if (result) {
    return <QuizResults quiz={quiz as QuizRow} result={result} studySetId={studySetId} onRetake={() => { setAnswers({}); setResult(null); }} onExit={onExit} />;
  }

  const answered = questions.filter((q) => answers[q.id] && !answers[q.id]?.skipped).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{quiz.title}</h2>
          <p className="text-xs text-muted-foreground">{answered}/{questions.length} answered — answers grade when you submit</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onExit}>← Back to quizzes</Button>
      </div>

      {questions.map((q, i) => (
        <Card key={q.id}>
          <CardContent className="space-y-3 py-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Badge variant="secondary">Q{i + 1} · {q.type.replace(/_/g, " ").toLowerCase()}</Badge>
              <Badge variant="outline" className="text-[10px]">{q.difficulty.toLowerCase()}</Badge>
            </div>
            <Markdown content={q.stem} />
            <QuestionInput
              question={q}
              value={answers[q.id]}
              onChange={(r) => setAnswers((prev) => ({ ...prev, [q.id]: r }))}
            />
            {q.warnings.length > 0 && (
              <p className="text-xs text-muted-foreground">⚠ {q.warnings.join(" · ")}</p>
            )}
          </CardContent>
        </Card>
      ))}

      <div className="sticky bottom-4 flex items-center justify-center gap-3">
        <Button size="lg" onClick={() => void onSubmit()} disabled={submit.isPending} className="shadow-lg">
          {submit.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="mr-2 h-4 w-4" aria-hidden="true" />}
          Submit ({answered}/{questions.length})
        </Button>
      </div>
    </div>
  );
}

function QuestionInput({
  question,
  value,
  onChange,
}: {
  question: NonNullable<QuizRow["questions"]>[number];
  value?: Response;
  onChange: (r: Response) => void;
}) {
  const options = question.options ?? [];
  const type = question.type.toUpperCase();
  const orderIds = value?.order ?? options.map((o) => o.id);

  switch (type) {
    case "MULTIPLE_CHOICE":
      return (
        <div role="radiogroup" aria-label="Answer options" className="space-y-1.5">
          {options.map((o) => (
            <label
              key={o.id}
              className={cn(
                "flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 text-sm transition-colors",
                value?.selectedIds?.[0] === o.id ? "border-primary bg-primary/5" : "border-border hover:border-primary/40",
              )}
            >
              <input
                type="radio"
                name={question.id}
                checked={value?.selectedIds?.[0] === o.id}
                onChange={() => onChange({ selectedIds: [o.id] })}
                className="mt-0.5 accent-[hsl(var(--primary))]"
              />
              <span className="min-w-0 flex-1">{o.text}</span>
            </label>
          ))}
        </div>
      );

    case "MULTI_SELECT":
      return (
        <div className="space-y-1.5">
          {options.map((o) => {
            const checked = value?.selectedIds?.includes(o.id) ?? false;
            return (
              <label
                key={o.id}
                className={cn(
                  "flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 text-sm transition-colors",
                  checked ? "border-primary bg-primary/5" : "border-border hover:border-primary/40",
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() =>
                    onChange({
                      selectedIds: checked
                        ? (value?.selectedIds ?? []).filter((id) => id !== o.id)
                        : [...(value?.selectedIds ?? []), o.id],
                    })
                  }
                  className="mt-0.5 accent-[hsl(var(--primary))]"
                />
                <span className="min-w-0 flex-1">{o.text}</span>
              </label>
            );
          })}
          <p className="text-xs text-muted-foreground">Select all that apply — partial credit applies.</p>
        </div>
      );

    case "SHORT_ANSWER":
      return (
        <Input
          value={value?.text ?? ""}
          onChange={(e) => onChange({ text: e.target.value })}
          placeholder="Type your answer…"
          aria-label="Short answer"
        />
      );

    case "CODE_TRACING":
      return (
        <div>
          <textarea
            value={value?.text ?? ""}
            onChange={(e) => onChange({ text: e.target.value })}
            rows={4}
            placeholder="What does this code print / return?"
            aria-label="Code tracing answer"
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      );

    case "NUMERICAL":
      return (
        <div className="flex items-center gap-2">
          <Input
            type="number"
            step="any"
            value={value?.numeric ?? ""}
            onChange={(e) => onChange({ numeric: e.target.value === "" ? undefined : Number(e.target.value) })}
            placeholder="Value"
            aria-label="Numerical answer"
            className="max-w-[200px]"
          />
          <span className="text-xs text-muted-foreground">Tolerances are applied on grading.</span>
        </div>
      );

    case "ORDERING":
    case "DERIVATION_STEPS":
      return (
        <div className="space-y-1.5">
          {orderIds.map((id, pos) => {
            const opt = options.find((o) => o.id === id);
            if (!opt) return null;
            const move = (dir: -1 | 1) => {
              const next = [...orderIds];
              const target = pos + dir;
              if (target < 0 || target >= next.length) return;
              [next[pos], next[target]] = [next[target], next[pos]];
              onChange({ order: next });
            };
            return (
              <div key={id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                <span className="w-5 shrink-0 text-center font-mono text-xs text-muted-foreground">{pos + 1}</span>
                <span className="min-w-0 flex-1">{opt.text}</span>
                <span className="flex shrink-0 gap-0.5">
                  <Button variant="ghost" size="icon" className="h-6 w-6" aria-label="Move up" disabled={pos === 0} onClick={() => move(-1)}>
                    <ArrowUp className="h-3 w-3" aria-hidden="true" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-6 w-6" aria-label="Move down" disabled={pos === orderIds.length - 1} onClick={() => move(1)}>
                    <ArrowDown className="h-3 w-3" aria-hidden="true" />
                  </Button>
                </span>
              </div>
            );
          })}
          <p className="text-xs text-muted-foreground">Reorder with the arrows — {type === "DERIVATION_STEPS" ? "each step must be in its correct position." : "position-accurate scoring."}</p>
        </div>
      );

    case "MATCHING":
      return (
        <div className="space-y-1.5">
          {options.map((o) => (
            <div key={o.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
              <span className="min-w-0 flex-1">{o.text}</span>
              <Select
                value={value?.pairs?.[o.id] ?? ""}
                onValueChange={(v) => onChange({ pairs: { ...(value?.pairs ?? {}), [o.id]: v } })}
              >
                <SelectTrigger className="h-8 w-44 shrink-0 text-xs" aria-label={`Match for ${o.text}`}>
                  <SelectValue placeholder="Match…" />
                </SelectTrigger>
                <SelectContent>
                  {(question.matchValues ?? []).map((v) => (
                    <SelectItem key={v} value={v} className="text-xs">{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      );

    default:
      return <p className="text-xs text-muted-foreground">Unsupported question type: {question.type}</p>;
  }
}

/* --------------------------------- results --------------------------------- */

function QuizResults({
  quiz,
  result,
  studySetId,
  onRetake,
  onExit,
}: {
  quiz: QuizRow;
  result: QuizAttemptResult;
  studySetId: string;
  onRetake: () => void;
  onExit: () => void;
}) {
  const pct = Math.round(result.score * 100);
  const byId = new Map((result.results ?? []).map((r) => [r.questionId, r]));

  return (
    <div className="space-y-4">
      <Card className={pct >= 70 ? "border-[hsl(var(--success))]/40" : pct >= 40 ? "border-[hsl(var(--warning))]/40" : "border-destructive/40"}>
        <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
          <p className="text-4xl font-semibold tabular-nums">{pct}%</p>
          <p className="text-sm text-muted-foreground">
            {result.results.filter((r) => r.correct).length}/{result.results.length} correct
          </p>
          {result.weakTopics.length > 0 && (
            <div className="mt-2 space-y-1">
              <p className="text-xs font-medium">Objectives to review:</p>
              <ul className="list-inside list-disc text-xs text-muted-foreground">
                {result.weakTopics.slice(0, 5).map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <Button variant="outline" size="sm" onClick={onRetake}><RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Retake</Button>
            <Button variant="ghost" size="sm" onClick={onExit}>Back to quizzes</Button>
          </div>
        </CardContent>
      </Card>

      {(quiz.questions ?? []).map((q, i) => {
        const r = byId.get(q.id);
        if (!r) return null;
        const rationale = r.distractorRationale ?? {};
        return (
          <Card key={q.id} className={r.correct ? "border-[hsl(var(--success))]/30" : "border-destructive/30"}>
            <CardContent className="space-y-2.5 py-5">
              <div className="flex items-center justify-between gap-2">
                <Badge variant="secondary">Q{i + 1}</Badge>
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  {r.correct ? (
                    <><CheckCircle2 className="h-4 w-4 text-[hsl(var(--success))]" aria-hidden="true" /> Correct</>
                  ) : r.score > 0 ? (
                    <>{Math.round(r.score * 100)}% — partially correct</>
                  ) : (
                    <><XCircle className="h-4 w-4 text-destructive" aria-hidden="true" /> Incorrect</>
                  )}
                </span>
              </div>
              <Markdown content={q.stem} />
              <div className="rounded-lg bg-muted/50 p-3 text-sm">
                <p className="text-muted-foreground">{r.feedback}</p>
                {r.explanation && <p className="mt-1.5">{r.explanation}</p>}
              </div>
              {Object.keys(rationale).length > 0 && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Why the wrong options are wrong</summary>
                  <ul className="mt-2 space-y-1.5">
                    {(q.options ?? []).filter((o) => rationale[o.id]).map((o) => (
                      <li key={o.id} className="flex gap-2 text-xs">
                        <span className="min-w-0 flex-1 rounded bg-destructive/10 px-2 py-1">{o.text}</span>
                        <span className="min-w-0 flex-1 px-2 py-1 text-muted-foreground">{rationale[o.id]}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {(q.anchors ?? []).length > 0 && (
                <CitationList anchors={anchorsFrom(q.anchors)} studySetId={studySetId} max={2} size="sm" />
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
