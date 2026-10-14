"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Bot,
  BookOpen,
  CalendarDays,
  Dumbbell,
  FileStack,
  HelpCircle,
  Loader2,
  Plus,
  type LucideIcon,
  Sparkles,
  Timer,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { JobProgressRow } from "@/components/shared/job-status";
import { PipelineStatusBar } from "@/components/shared/pipeline-status";
import { ingestJobFor } from "@/lib/pipeline-phases";
import { useStudySet, useGenerateGuide, useGenerateDeck, useGenerateQuiz, useGenerateExercises, usePatchStudySet } from "@/hooks/use-api";

export default function OverviewTab() {
  const { studySetId } = useParams<{ studySetId: string }>();
  const { data, isLoading } = useStudySet(studySetId);
  const patch = usePatchStudySet(studySetId);
  const genGuide = useGenerateGuide(studySetId);
  const genDeck = useGenerateDeck(studySetId);
  const genQuiz = useGenerateQuiz(studySetId);
  const genExercises = useGenerateExercises(studySetId);

  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState("");

  const set = data?.studySet;
  const outputs = set?.outputTypes ?? [];
  const guide = data?.guides?.[0];
  const deck = data?.decks?.[0];
  const activeJobs = (data?.jobs ?? []).filter((j) => j.status === "QUEUED" || j.status === "RUNNING");

  async function saveTitle() {
    if (!title.trim() || title.trim() === set?.title) {
      setEditingTitle(false);
      return;
    }
    try {
      await patch.mutateAsync({ title: title.trim() });
      toast.success("Renamed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Rename failed");
    } finally {
      setEditingTitle(false);
    }
  }

  async function run(label: string, fn: () => Promise<unknown>) {
    try {
      await fn();
      toast.success(`${label} generation started`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Could not start ${label.toLowerCase()}`);
    }
  }

  if (isLoading || !set) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-2/3 animate-pulse rounded bg-muted" />
        <div className="h-32 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  const ready = set.counts.sourcesReady > 0;
  const examDays = set.examDate ? Math.ceil((new Date(set.examDate).getTime() - Date.now()) / 86400000) : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex flex-wrap items-center gap-2">
          {editingTitle ? (
            <div className="flex flex-1 items-center gap-2">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") void saveTitle();
                  if (e.key === "Escape") setEditingTitle(false);
                }}
                className="max-w-md text-xl font-semibold"
              />
              <Button size="sm" onClick={() => void saveTitle()} disabled={patch.isPending}>Save</Button>
              <Button size="sm" variant="ghost" onClick={() => setEditingTitle(false)}>Cancel</Button>
            </div>
          ) : (
            <h1
              className="cursor-text text-2xl font-semibold tracking-tight hover:text-primary"
              title="Click to rename"
              onClick={() => {
                setTitle(set.title);
                setEditingTitle(true);
              }}
            >
              {set.title}
            </h1>
          )}
          <Badge variant="secondary">{set.learnerLevel.replace(/_/g, " ").toLowerCase()}</Badge>
          {examDays != null && (
            <Badge variant={examDays <= 14 ? "warning" : "outline"} className="gap-1">
              <CalendarDays className="h-3 w-3" aria-hidden="true" />
              {examDays >= 0 ? `exam in ${examDays}d` : "exam passed"}
            </Badge>
          )}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {set.counts.sourcesReady}/{set.counts.sources} sources indexed
          {activeJobs.length > 0 && " · working…"}
        </p>
      </div>

      {!ready && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <p className="text-sm">
              {set.counts.sources === 0
                ? "No sources yet — upload a lecture, paper, or notes to get started."
                : "Sources are still processing. Outputs will generate automatically once they're indexed."}
            </p>
            <Button asChild size="sm">
              <Link href={`/create?studySetId=${studySetId}`}>
                <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Add sources
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Quick actions */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ActionCard
          icon={BookOpen}
          title="Study guide"
          state={guide ? (guide.status === "GENERATING" ? "generating" : `${guide.sections?.length ?? 0} sections`) : "not created"}
          busy={guide?.status === "GENERATING"}
          disabled={!ready}
          href={guide ? `/study-sets/${studySetId}/guide` : undefined}
          onAction={
            guide
              ? () => void run("Guide", () => genGuide.mutateAsync({ regenerate: true }))
              : () => void run("Guide", () => genGuide.mutateAsync({}))
          }
          actionLabel={guide ? "Regenerate" : "Generate"}
          enabled={outputs.includes("GUIDE")}
        />
        <ActionCard
          icon={Timer}
          title="Flashcards"
          state={deck ? `${data?.decks.reduce((n, d) => n + d.total, 0)} cards · ${data?.decks.reduce((n, d) => n + d.due, 0)} due` : "not created"}
          busy={genDeck.isPending}
          disabled={!ready}
          href={deck ? `/study-sets/${studySetId}/flashcards` : undefined}
          onAction={() => void run("Flashcards", () => genDeck.mutateAsync(deck ? { deckId: deck.id } : {}))}
          actionLabel={deck ? "Add cards" : "Generate"}
          enabled={outputs.includes("FLASHCARDS")}
        />
        <ActionCard
          icon={HelpCircle}
          title="Quiz"
          state={data?.quizzes.length ? `${data.quizzes.length} generated` : "not created"}
          busy={genQuiz.isPending}
          disabled={!ready}
          href={data?.quizzes.length ? `/study-sets/${studySetId}/quiz` : undefined}
          onAction={() => void run("Quiz", () => genQuiz.mutateAsync({ difficulty: "adaptive" }))}
          actionLabel="Generate"
          enabled={outputs.includes("QUIZ")}
        />
        <ActionCard
          icon={Dumbbell}
          title="Exercises"
          state={data?.exerciseSets.length ? `${data.exerciseSets.length} sets` : "not created"}
          busy={genExercises.isPending}
          disabled={!ready}
          href={data?.exerciseSets.length ? `/study-sets/${studySetId}/exercises` : undefined}
          onAction={() => void run("Exercises", () => genExercises.mutateAsync({}))}
          actionLabel="Generate"
          enabled={outputs.includes("EXERCISES")}
        />
      </div>

      {/* Tutor CTA */}
      {outputs.includes("TUTOR") && (
        <Card className="border-primary/30">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-primary/10 p-2.5 text-primary">
                <Bot className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <p className="font-medium">Ask the grounded tutor</p>
                <p className="text-sm text-muted-foreground">
                  Hints before solutions, citations for every claim, honest when something isn&apos;t in your sources.
                </p>
              </div>
            </div>
            <Button asChild size="sm" disabled={!ready}>
              <Link href={`/study-sets/${studySetId}/tutor`}>Open tutor</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Recent activity */}
      <Card>
        <CardHeader className="pb-1">
          <CardTitle className="flex items-center gap-2 text-sm">
            {activeJobs.length > 0 ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" aria-hidden="true" />
            ) : (
              <Sparkles className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            )}
            Recent activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          {(data?.jobs ?? []).length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">Nothing generated yet.</p>
          ) : (
            (data?.jobs ?? []).slice(0, 6).map((j, i) => <JobProgressRow key={j.id ?? i} job={j} />)
          )}
        </CardContent>
      </Card>

      {/* Source strip */}
      <Card>
        <CardHeader className="pb-1">
          <CardTitle className="flex items-center gap-2 text-sm">
            <FileStack className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" /> Sources
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border/70">
            {(data?.sources ?? []).map((s) => (
              <li key={s.id} className="py-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <Link href={`/study-sets/${studySetId}/sources?source=${s.id}`} className="min-w-0 flex-1 truncate hover:text-primary">
                    {s.title}
                  </Link>
                  <Badge variant={s.status === "READY" ? "success" : s.status === "FAILED" ? "destructive" : "secondary"}>{s.status}</Badge>
                </div>
                {s.status !== "READY" && (
                  <PipelineStatusBar compact status={s.status} job={ingestJobFor(data?.jobs, s.id)} className="mt-1.5" />
                )}
              </li>
            ))}
            {(data?.sources ?? []).length === 0 && <li className="py-2 text-sm text-muted-foreground">No sources yet.</li>}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function ActionCard({
  icon: Icon,
  title,
  state,
  onAction,
  actionLabel,
  href,
  busy,
  disabled,
  enabled = true,
}: {
  icon: LucideIcon;
  title: string;
  state: string;
  onAction: () => void;
  actionLabel: string;
  href?: string;
  busy?: boolean;
  disabled?: boolean;
  enabled?: boolean;
}) {
  return (
    <Card className={disabled ? "opacity-60" : undefined}>
      <CardContent className="flex h-full flex-col py-4">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <Icon className="h-4 w-4" aria-hidden="true" />
          </div>
          <p className="font-medium">{title}</p>
        </div>
        <p className="mt-1.5 flex-1 text-xs text-muted-foreground">
          {enabled ? state : `${state} · not in this set's outputs`}
        </p>
        <div className="mt-3 flex gap-2">
          {href && (
            <Button asChild size="sm" variant="outline" disabled={disabled}>
              {/* aria-label distinguishes the four tool cards' identical "Open" text. */}
              <Link href={href} aria-label={`Open ${title.toLowerCase()}`}>Open</Link>
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onAction} disabled={disabled || busy}>
            {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            {actionLabel}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
