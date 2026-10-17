"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { ArrowLeft, Archive, ArchiveRestore, EyeOff, Flag, History, Loader2, RefreshCw, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { cn } from "@/lib/utils";
import { targetLanguage } from "@/lib/polylingue/levels";
import type { Exercise, LessonContent } from "@/lib/polylingue/content";
import { useDismissReports, useLessonReview, useRegenerateLesson, useRestoreVersion, useRetireLesson, useSaveLesson, type LessonReview } from "@/hooks/use-polylingue-admin";

/** Admin review of one PolyLingue lesson: correct it, regenerate it, retire it, or restore a version. */
export default function LessonReviewPage() {
  return (
    <Suspense fallback={null}>
      <LessonReviewInner />
    </Suspense>
  );
}

function LessonReviewInner() {
  const { lessonId } = useParams<{ lessonId: string }>();
  const focus = Number(useSearchParams().get("exercise") ?? -1);
  const { data, isLoading, error } = useLessonReview(lessonId);

  if (error) return <p className="mx-auto mt-6 max-w-4xl px-4 text-sm text-destructive">{error.message}</p>;
  if (isLoading || !data) return <div className="mx-auto mt-6 h-64 max-w-4xl animate-pulse rounded-lg bg-muted" />;
  return <Editor key={`${data.id}:${data.editedAt ?? ""}:${data.versions.length}:${data.status}`} data={data} focus={focus} />;
}

function Editor({ data, focus }: { data: LessonReview; focus: number }) {
  const save = useSaveLesson(data.id);
  const regenerate = useRegenerateLesson(data.id);
  const retire = useRetireLesson(data.id);
  const restore = useRestoreVersion(data.id);
  const dismiss = useDismissReports();
  const confirm = useConfirm();
  const [content, setContent] = useState<LessonContent | null>(data.content ? structuredClone(data.content) : null);
  const [title, setTitle] = useState(data.title);
  const [note, setNote] = useState("");
  const dirty = JSON.stringify(content) !== JSON.stringify(data.content) || title !== data.title;
  const writing = data.status === "QUEUED" || data.status === "GENERATING";

  useEffect(() => {
    if (focus >= 0) document.getElementById(`exercise-${focus}`)?.scrollIntoView({ block: "center" });
  }, [focus]);

  const setExercise = (i: number, patch: Partial<Exercise>) =>
    setContent((c) => (c ? { ...c, exercises: c.exercises.map((e, j) => (j === i ? { ...e, ...patch } : e)) } : c));

  async function onSave() {
    if (!content) return;
    try {
      const r = await save.mutateAsync({ title, content, note: note.trim() || undefined });
      toast.success(r.changed.length ? `Saved: ${r.changed.length} exercise${r.changed.length > 1 ? "s" : ""} corrected, their reports closed.` : "Saved.");
      setNote("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-6 sm:px-6">
      <Link href="/admin?tab=polylingue" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Admin › PolyLingue
      </Link>

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">
              {targetLanguage(data.curriculum.targetLang)?.name} {data.curriculum.level}
            </Badge>
            <span className="text-xs text-muted-foreground">{data.unitTitle}</span>
            {data.retiredAt && <Badge variant="outline">retired</Badge>}
            {writing && (
              <Badge variant="outline" className="gap-1">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> being written
              </Badge>
            )}
            {data.status === "FAILED" && <Badge variant="destructive">failed: {data.error}</Badge>}
            {data.audioAt && <span className="text-xs text-muted-foreground">audio ready {new Date(data.audioAt).toLocaleDateString()}</span>}
            <span className="ml-auto text-xs text-muted-foreground">{data.model}</span>
          </div>
          <div className="space-y-1">
            <Label htmlFor="lesson-title">Title</Label>
            <Input id="lesson-title" value={title} onChange={(e) => setTitle(e.target.value)} disabled={!content} />
          </div>
          <p className="text-xs text-muted-foreground">Focus: {data.focus}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={writing || regenerate.isPending}
              onClick={async () => {
                const ok = await confirm({
                  title: "Write this lesson again?",
                  description: "The AI model writes a new version for every learner of this course; the current version is kept and can be restored.",
                  confirmLabel: "Regenerate",
                });
                if (ok) await regenerate.mutateAsync();
              }}
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" /> Regenerate
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={async () => {
                const retiring = !data.retiredAt;
                if (
                  retiring &&
                  !(await confirm({
                    title: "Retire this lesson?",
                    description: "It is no longer offered to learners (their progress on it stays). You can bring it back.",
                    confirmLabel: "Retire",
                    destructive: true,
                  }))
                )
                  return;
                await retire.mutateAsync(retiring);
              }}
            >
              {data.retiredAt ? <ArchiveRestore className="h-4 w-4" aria-hidden="true" /> : <Archive className="h-4 w-4" aria-hidden="true" />}
              {data.retiredAt ? "Bring back" : "Retire"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {!content ? (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">{writing ? "The lesson is being written…" : "This lesson has no content yet."}</CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="space-y-3 p-4">
              <h2 className="text-sm font-semibold">Introduction and words</h2>
              <Textarea value={content.intro} onChange={(e) => setContent({ ...content, intro: e.target.value })} rows={3} aria-label="Introduction" />
              <div className="grid gap-2 sm:grid-cols-2">
                {content.words.map((w, i) => (
                  <div key={i} className="grid grid-cols-2 gap-1">
                    <Input
                      value={w.term}
                      aria-label={`Word ${i + 1}`}
                      onChange={(e) => setContent({ ...content, words: content.words.map((x, j) => (j === i ? { ...x, term: e.target.value } : x)) })}
                    />
                    <Input
                      value={w.translation}
                      aria-label={`Meaning of word ${i + 1}`}
                      onChange={(e) => setContent({ ...content, words: content.words.map((x, j) => (j === i ? { ...x, translation: e.target.value } : x)) })}
                    />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {content.exercises.map((e, i) => {
            const reports = data.reports.filter((r) => r.index === i && !r.resolvedAt);
            const hidden = data.hiddenExercises.includes(i);
            return (
              <Card key={i} id={`exercise-${i}`} className={cn(i === focus && "ring-2 ring-primary", hidden && "border-red-500/50")}>
                <CardContent className="space-y-2 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">Exercise {i + 1}</span>
                    <Badge variant="secondary">{e.type}</Badge>
                    {hidden && (
                      <Badge variant="outline" className="gap-1 border-red-500/50 text-red-600">
                        <EyeOff className="h-3 w-3" aria-hidden="true" /> hidden from learners
                      </Badge>
                    )}
                    {reports.length > 0 && (
                      <>
                        <Badge variant="outline" className="gap-1 border-amber-500/50 text-amber-700">
                          <Flag className="h-3 w-3" aria-hidden="true" /> {reports.length} report{reports.length > 1 ? "s" : ""}
                        </Badge>
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => dismiss.mutate({ lessonId: data.id, index: i })}>
                          Dismiss reports
                        </Button>
                      </>
                    )}
                  </div>
                  {reports.length > 0 && (
                    <ul className="rounded-md bg-amber-500/10 p-2 text-xs">
                      {reports.map((r) => (
                        <li key={r.id}>
                          <span className="font-medium">{r.reason.replace("_", " ")}</span>
                          {r.comment ? `: “${r.comment}”` : ""} <span className="text-muted-foreground">({r.by})</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <Field label="Prompt" value={e.prompt} onChange={(v) => setExercise(i, { prompt: v })} />
                  {(e.type === "listen" || e.type === "cloze" || e.type === "translate") && <Field label={e.type === "cloze" ? "Sentence (with {{blank}})" : "Text"} value={e.text} onChange={(v) => setExercise(i, { text: v })} />}
                  {e.type !== "match" && <Field label="Answer" value={e.answer} onChange={(v) => setExercise(i, { answer: v })} />}
                  {(e.type === "choice" || e.type === "listen" || e.type === "cloze") && (
                    <Field label="Options (one per line)" multiline value={e.options.join("\n")} onChange={(v) => setExercise(i, { options: v.split("\n").map((s) => s.trim()).filter(Boolean) })} />
                  )}
                  {e.type === "translate" && (
                    <Field label="Other correct answers (one per line)" multiline value={e.accepted.join("\n")} onChange={(v) => setExercise(i, { accepted: v.split("\n").map((s) => s.trim()).filter(Boolean) })} />
                  )}
                  {e.type === "match" && (
                    <Field
                      label="Pairs (word = meaning, one per line)"
                      multiline
                      value={e.pairs.map((p) => `${p.left} = ${p.right}`).join("\n")}
                      onChange={(v) =>
                        setExercise(i, {
                          pairs: v
                            .split("\n")
                            .map((line) => line.split("="))
                            .filter((p) => p.length === 2)
                            .map(([left, right]) => ({ left: left.trim(), right: right.trim() })),
                        })
                      }
                    />
                  )}
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Field label="Explanation" value={e.explanation} onChange={(v) => setExercise(i, { explanation: v })} />
                    <Field label="Audio (text read aloud)" value={e.audio} onChange={(v) => setExercise(i, { audio: v })} />
                  </div>
                </CardContent>
              </Card>
            );
          })}

          <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background/95 p-3 backdrop-blur">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you changed (optional)" className="h-9 max-w-sm" aria-label="Change note" />
            <span className="text-xs text-muted-foreground">Saving keeps the current version; corrected exercises are shown again.</span>
            <Button className="ml-auto gap-1.5" onClick={() => void onSave()} disabled={!dirty || save.isPending}>
              {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
              Save corrections
            </Button>
          </div>
        </>
      )}

      {data.versions.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <History className="h-4 w-4" aria-hidden="true" /> Earlier versions
            </h2>
            <ul className="divide-y divide-border/60 text-sm">
              {data.versions.map((v) => (
                <li key={v.version} className="flex flex-wrap items-center gap-2 py-1.5">
                  <span className="font-medium">Version {v.version}</span>
                  <span className="text-muted-foreground">
                    {v.note} · {new Date(v.createdAt).toLocaleString()} · {v.by}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto h-7"
                    onClick={async () => {
                      if (await confirm({ title: `Restore version ${v.version}?`, description: "The current version is kept too, so you can come back to it.", confirmLabel: "Restore" })) {
                        await restore.mutateAsync(v.version);
                        toast.success(`Version ${v.version} restored.`);
                      }
                    }}
                  >
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Field({ label, value, onChange, multiline }: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean }) {
  return (
    <label className="block space-y-1 text-xs text-muted-foreground">
      {label}
      {multiline ? (
        <Textarea value={value} onChange={(e) => onChange(e.target.value)} rows={Math.min(6, Math.max(2, value.split("\n").length))} className="text-sm text-foreground" />
      ) : (
        <Input value={value} onChange={(e) => onChange(e.target.value)} className="h-9 text-sm text-foreground" />
      )}
    </label>
  );
}
