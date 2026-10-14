"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import {
  AlertTriangle,
  BookOpenCheck,
  CheckCircle2,
  Clock,
  Dumbbell,
  Eye,
  Lightbulb,
  Loader2,
  Plus,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Markdown } from "@/components/shared/markdown";
import { CitationList, type AnchorData } from "@/components/shared/citation-chip";
import {
  useExerciseSets,
  useExerciseSet,
  useGenerateExercises,
  useSubmitExerciseAttempt,
  useRevealSolution,
  type ExerciseRow,
  type AnchorRef,
} from "@/hooks/use-api";
import { cn } from "@/lib/utils";

const EXERCISE_TYPES = ["derivation", "quantitative", "proof", "algorithm_design", "code_completion", "code_debugging", "conceptual_transfer", "paper_critique"];

export default function ExercisesPage() {
  const { studySetId } = useParams<{ studySetId: string }>();
  const { data, isLoading } = useExerciseSets(studySetId);
  const generate = useGenerateExercises(studySetId);
  const [openSetId, setOpenSetId] = useState<string | null>(null);
  const [genOpen, setGenOpen] = useState(false);
  const [topic, setTopic] = useState("");
  const [count, setCount] = useState(4);
  const [types, setTypes] = useState<string[]>([]);
  const [difficulty, setDifficulty] = useState("hard");

  async function onGenerate() {
    try {
      await generate.mutateAsync({ topic: topic.trim() || undefined, count, ...(types.length ? { types } : {}), difficulty });
      toast.success("Exercise generation started");
      setGenOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start generation");
    }
  }

  if (openSetId) {
    return <ExerciseSetView studySetId={studySetId} exerciseSetId={openSetId} onExit={() => setOpenSetId(null)} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Exercises</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Advanced STEM problems with prerequisites, assumptions, progressive hints, and rubric-based feedback.
          </p>
        </div>
        <Button onClick={() => setGenOpen(true)} disabled={generate.isPending}>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> Generate exercises
        </Button>
      </div>

      {isLoading ? (
        <div className="h-32 animate-pulse rounded-lg bg-muted" />
      ) : (data?.exerciseSets ?? []).length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="rounded-full bg-primary/10 p-3 text-primary"><Dumbbell className="h-6 w-6" aria-hidden="true" /></div>
            <div>
              <p className="font-medium">No exercise sets yet</p>
              <p className="mt-1 text-sm text-muted-foreground">Derivations, quantitative problems, code debugging, conceptual transfer — from your sources.</p>
            </div>
            <Button onClick={() => setGenOpen(true)}>Generate exercises</Button>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {(data?.exerciseSets ?? []).map((s) => (
            <li key={s.id}>
              <div className="flex items-center gap-3 rounded-lg border border-border px-4 py-3 transition-colors hover:border-primary/40">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{s.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{s.status}</p>
                </div>
                <Button size="sm" variant={s.status === "READY" ? "default" : "outline"} disabled={s.status !== "READY"} onClick={() => setOpenSetId(s.id)}>
                  {s.status === "READY" ? "Work on set" : s.status === "GENERATING" ? "Generating…" : s.status}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={genOpen} onOpenChange={setGenOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate exercises</DialogTitle>
            <DialogDescription>Grounded in your sources where possible; transfer problems are labeled.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="topic">Topic (optional)</Label>
              <Input id="topic" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. gradient descent variants" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ex-count">Exercises: {count}</Label>
                <input id="ex-count" type="range" min={1} max={10} value={count} onChange={(e) => setCount(Number(e.target.value))} className="w-full accent-[hsl(var(--primary))]" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ex-diff">Difficulty</Label>
                <select id="ex-diff" value={difficulty} onChange={(e) => setDifficulty(e.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <option value="easy">Easy</option>
                  <option value="medium">Medium</option>
                  <option value="hard">Hard</option>
                  <option value="advanced">Advanced</option>
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Types (empty = mixed)</Label>
              <div className="flex flex-wrap gap-1.5">
                {EXERCISE_TYPES.map((t) => {
                  const active = types.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setTypes((prev) => (active ? prev.filter((x) => x !== t) : [...prev, t]))}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-xs transition-colors",
                        active ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40",
                      )}
                    >
                      {t.replace(/_/g, " ")}
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
    </div>
  );
}

/* ------------------------------- set view ---------------------------------- */

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

function ExerciseSetView({ studySetId, exerciseSetId, onExit }: { studySetId: string; exerciseSetId: string; onExit: () => void }) {
  const { data, isLoading } = useExerciseSet(exerciseSetId);

  if (isLoading || !data) return <div className="h-64 animate-pulse rounded-lg bg-muted" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight">{data.exerciseSet.title}</h2>
        <Button variant="ghost" size="sm" onClick={onExit}>← Back to sets</Button>
      </div>
      {data.exerciseSet.exercises.map((ex) => (
        <ExerciseCard key={ex.id} exercise={ex} studySetId={studySetId} />
      ))}
    </div>
  );
}

function ExerciseCard({ exercise, studySetId }: { exercise: ExerciseRow; studySetId: string }) {
  const submit = useSubmitExerciseAttempt();
  const reveal = useRevealSolution();

  const [attempt, setAttempt] = useState("");
  const [hintsShown, setHintsShown] = useState(0);
  const [feedback, setFeedback] = useState<{ score: number; summary: string; criteria: { name: string; met: boolean; comment: string }[]; nextStep: string } | null>(null);
  const [solution, setSolution] = useState<string | null>(null);
  const [confirmReveal, setConfirmReveal] = useState(false);

  const isCode = exercise.type.startsWith("code_");
  const hints = exercise.hints ?? [];

  async function onSubmit() {
    if (attempt.trim().length < 5) {
      toast.error("Write your attempt first");
      return;
    }
    try {
      const res = await submit.mutateAsync({ exerciseId: exercise.id, submission: attempt });
      setFeedback(res.feedback);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Submit failed");
    }
  }

  async function doReveal() {
    setConfirmReveal(false);
    try {
      const res = await reveal.mutateAsync(exercise.id);
      setSolution(res.solution);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not reveal");
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 py-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">#{exercise.ordinal}</span>
            <h3 className="font-semibold">{exercise.title}</h3>
            <Badge variant="secondary">{exercise.type.replace(/_/g, " ")}</Badge>
            <Badge variant={exercise.grounded ? "success" : "outline"} className="gap-1 text-[10px]">
              <BookOpenCheck className="h-3 w-3" aria-hidden="true" />
              {exercise.grounded ? "grounded in source" : "transfer — beyond source"}
            </Badge>
            {exercise.estimatedMinutes && (
              <Badge variant="outline" className="gap-1 text-[10px]">
                <Clock className="h-3 w-3" aria-hidden="true" /> ~{exercise.estimatedMinutes} min
              </Badge>
            )}
            <Badge variant="outline" className="text-[10px]">{exercise.difficulty}</Badge>
          </div>
        </div>

        <Markdown content={exercise.prompt} />

        {(exercise.prerequisites.length > 0 || exercise.assumptions.length > 0 || exercise.requiredKnowledge.length > 0) && (
          <div className="grid gap-3 rounded-lg bg-muted/40 p-3 text-xs sm:grid-cols-3">
            {exercise.prerequisites.length > 0 && (
              <div>
                <p className="mb-1 font-medium">Prerequisites</p>
                <ul className="list-inside list-disc space-y-0.5 text-muted-foreground">
                  {exercise.prerequisites.map((p, i) => <li key={i}>{p}</li>)}
                </ul>
              </div>
            )}
            {exercise.assumptions.length > 0 && (
              <div>
                <p className="mb-1 font-medium">Assumptions</p>
                <ul className="list-inside list-disc space-y-0.5 text-muted-foreground">
                  {exercise.assumptions.map((a, i) => <li key={i}>{a}</li>)}
                </ul>
              </div>
            )}
            {exercise.requiredKnowledge.length > 0 && (
              <div>
                <p className="mb-1 font-medium">You&apos;ll need</p>
                <ul className="list-inside list-disc space-y-0.5 text-muted-foreground">
                  {exercise.requiredKnowledge.map((k, i) => <li key={i}>{k}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}

        {exercise.expectedOutput && (
          <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground/80">Expected format:</span> {exercise.expectedOutput}</p>
        )}

        {exercise.warnings.length > 0 && (
          <p className="flex items-start gap-1.5 text-xs text-[hsl(var(--warning))]">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" /> {exercise.warnings.join(" · ")}
          </p>
        )}

        {/* Hints — one at a time, on request */}
        {hints.length > 0 && (
          <div className="space-y-1.5">
            {hints.slice(0, hintsShown).map((h, i) => (
              <p key={i} className="rounded-lg border border-[hsl(var(--warning))]/30 bg-[hsl(var(--warning))]/5 px-3 py-2 text-sm">
                <Lightbulb className="mr-1.5 inline h-3.5 w-3.5 text-[hsl(var(--warning))]" aria-hidden="true" />
                <span className="font-medium">Hint {i + 1}:</span> {h}
              </p>
            ))}
            {hintsShown < hints.length && (
              <Button variant="outline" size="sm" onClick={() => setHintsShown((n) => n + 1)} className="gap-1.5">
                <Lightbulb className="h-3.5 w-3.5" aria-hidden="true" /> Show hint {hintsShown + 1} of {hints.length}
              </Button>
            )}
          </div>
        )}

        {/* Attempt */}
        <div className="space-y-1.5">
          <Label htmlFor={`attempt-${exercise.id}`}>Your attempt</Label>
          <textarea
            id={`attempt-${exercise.id}`}
            value={attempt}
            onChange={(e) => setAttempt(e.target.value)}
            rows={isCode ? 8 : 5}
            placeholder={isCode ? "// your code here…" : "Show your reasoning step by step…"}
            className={cn(
              "w-full rounded-md border border-input bg-transparent px-3 py-2 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isCode ? "font-mono text-sm" : "text-sm",
            )}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => void onSubmit()} disabled={submit.isPending}>
              {submit.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
              Submit attempt
            </Button>
            {exercise.hasSolution && !solution && (
              <Button size="sm" variant="ghost" onClick={() => setConfirmReveal(true)} className="gap-1.5 text-muted-foreground">
                <Eye className="h-3.5 w-3.5" aria-hidden="true" /> Reveal solution
              </Button>
            )}
            {exercise.anchors.length > 0 && (
              <span className="ml-auto"><CitationList anchors={anchorsFrom(exercise.anchors)} studySetId={studySetId} max={2} /></span>
            )}
          </div>
        </div>

        {/* Feedback */}
        {feedback && (
          <div className={cn("rounded-lg border p-4", feedback.score >= 0.7 ? "border-[hsl(var(--success))]/40" : feedback.score >= 0.4 ? "border-[hsl(var(--warning))]/40" : "border-destructive/40")}>
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-1.5 font-medium">
                {feedback.score >= 0.7 ? (
                  <><CheckCircle2 className="h-4 w-4 text-[hsl(var(--success))]" aria-hidden="true" /> Strong attempt</>
                ) : (
                  <><XCircle className="h-4 w-4 text-[hsl(var(--warning))]" aria-hidden="true" /> Needs work</>
                )}
              </p>
              <span className="text-sm tabular-nums text-muted-foreground">{Math.round(feedback.score * 100)}%</span>
            </div>
            <p className="mt-1.5 text-sm">{feedback.summary}</p>
            {feedback.criteria.length > 0 && (
              <ul className="mt-2 space-y-1">
                {feedback.criteria.map((c, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs">
                    {c.met ? (
                      <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-[hsl(var(--success))]" aria-hidden="true" />
                    ) : (
                      <XCircle className="mt-0.5 h-3 w-3 shrink-0 text-[hsl(var(--warning))]" aria-hidden="true" />
                    )}
                    <span><span className="font-medium">{c.name}:</span> {c.comment}</span>
                  </li>
                ))}
              </ul>
            )}
            {feedback.nextStep && <p className="mt-2 text-xs text-muted-foreground">Next: {feedback.nextStep}</p>}
          </div>
        )}

        {/* Solution — only after explicit confirmation */}
        {solution && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
            <p className="mb-2 text-sm font-medium">Worked solution</p>
            <Markdown content={solution} />
          </div>
        )}

        <Dialog open={confirmReveal} onOpenChange={setConfirmReveal}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reveal the full solution?</DialogTitle>
              <DialogDescription>
                Try the hints and your own attempt first — solutions stick better when they resolve a real struggle.
                This reveal is recorded.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setConfirmReveal(false)}>Keep trying</Button>
              <Button onClick={() => void doReveal()} disabled={reveal.isPending}>
                {reveal.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                Reveal solution
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
