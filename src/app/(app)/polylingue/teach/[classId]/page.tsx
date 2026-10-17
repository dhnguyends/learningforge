"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  Copy,
  Download,
  Lightbulb,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  UserMinus,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { LangBadge } from "@/components/polylingue/lang-badge";
import { StreakBadge } from "@/components/polylingue/goal-ring";
import { cn } from "@/lib/utils";
import { targetLanguage } from "@/lib/polylingue/levels";
import {
  useClassDashboard,
  useClassDifficulties,
  useClassOutline,
  useCreateAssignment,
  useDeleteAssignment,
  useDeleteClass,
  useRemoveStudent,
  useSuggestActivities,
  useUpdateClass,
  type ClassDashboard,
} from "@/hooks/use-polylingue";

/** A class: its students (activity, assignments, who falls behind), assignments, and common difficulties. */
export default function ClassPage() {
  const { classId } = useParams<{ classId: string }>();
  const router = useRouter();
  const { data, isLoading, error } = useClassDashboard(classId);
  const update = useUpdateClass(classId);
  const remove = useDeleteClass();
  const confirm = useConfirm();
  const [tab, setTab] = useState("students");
  const [target, setTarget] = useState<string>("");

  if (error) return <p className="mx-auto mt-6 max-w-5xl px-4 text-sm text-destructive">{error.message}</p>;
  if (isLoading || !data) return <div className="mx-auto mt-6 h-64 max-w-5xl animate-pulse rounded-lg bg-muted" />;
  const c = data.class;
  const behind = data.students.filter((s) => s.behind.length > 0).length;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-6 sm:px-6">
      <Link href="/polylingue/teach" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> My classes
      </Link>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 p-5">
          <LangBadge code={c.targetLang} size="lg" />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-tight">{c.name}</h1>
            <p className="text-sm text-muted-foreground">
              {targetLanguage(c.targetLang)?.name} {c.level} · {data.students.length} student{data.students.length === 1 ? "" : "s"}
              {behind > 0 && <span className="text-amber-600"> · {behind} falling behind</span>}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <span className="text-xs text-muted-foreground">Class code</span>
            <span className="flex items-center gap-1">
              <Button
                variant="outline"
                className="gap-1.5 font-mono text-base tracking-widest"
                onClick={() => {
                  void navigator.clipboard?.writeText(c.code);
                  toast.success(`Code ${c.code} copied.`);
                }}
                title="Copy the code for your students"
              >
                <Copy className="h-4 w-4" aria-hidden="true" /> {c.code}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                title="New code (the old one stops working)"
                aria-label="Make a new code"
                onClick={async () => {
                  if (!(await confirm({ title: "Make a new code?", description: "The current code stops working; students already in the class stay.", confirmLabel: "New code" }))) return;
                  await update.mutateAsync({ newCode: true });
                }}
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
              </Button>
            </span>
          </div>
        </CardContent>
      </Card>

      {(c.courseStatus === "QUEUED" || c.courseStatus === "GENERATING") && (
        <Card>
          <CardContent className="flex items-center gap-3 p-4 text-sm">
            <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden="true" /> The AI model is writing the {c.level} course (about a minute). You can assign
            work once it is ready.
          </CardContent>
        </Card>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList>
            <TabsTrigger value="students">Students</TabsTrigger>
            <TabsTrigger value="assignments">Assignments ({data.assignments.length})</TabsTrigger>
            <TabsTrigger value="difficulties">Common difficulties</TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <a href={`/api/polylingue/teach/classes/${classId}/export`} download>
                <Download className="h-4 w-4" aria-hidden="true" /> CSV
              </a>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-muted-foreground hover:text-destructive"
              onClick={async () => {
                const ok = await confirm({
                  title: `Delete “${c.name}”?`,
                  description: "Its assignments are deleted. Students keep their own course and progress.",
                  confirmLabel: "Delete",
                  destructive: true,
                });
                if (!ok) return;
                await remove.mutateAsync(classId);
                router.push("/polylingue/teach");
              }}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete
            </Button>
          </div>
        </div>

        <TabsContent value="students" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            Weekly target
            <Input
              type="number"
              min={10}
              max={600}
              step={5}
              aria-label="Minutes a week"
              className="h-8 w-20"
              value={target || String(c.weeklyMinutes)}
              onChange={(e) => setTarget(e.target.value)}
              onBlur={async () => {
                const n = Number(target);
                if (target && n >= 10 && n <= 600 && n !== c.weeklyMinutes) await update.mutateAsync({ weeklyMinutes: n });
                setTarget("");
              }}
            />
            minutes. A student falls behind after 3 days without practice, below the target, or with overdue work.
          </div>
          <StudentsTable classId={classId} data={data} />
        </TabsContent>

        <TabsContent value="assignments">
          <AssignmentsPanel classId={classId} data={data} />
        </TabsContent>

        <TabsContent value="difficulties">
          <DifficultiesPanel classId={classId} active={tab === "difficulties"} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StudentsTable({ classId, data }: { classId: string; data: ClassDashboard }) {
  const removeStudent = useRemoveStudent(classId);
  const confirm = useConfirm();
  const [sort, setSort] = useState<"behind" | "name" | "xp">("behind");
  const rows = useMemo(() => {
    const r = [...data.students];
    if (sort === "name") r.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "xp") r.sort((a, b) => b.xp7 - a.xp7);
    else r.sort((a, b) => b.behind.length - a.behind.length || a.name.localeCompare(b.name));
    return r;
  }, [data.students, sort]);

  if (data.students.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          No student yet. They join from PolyLingue › My classes with the code <span className="font-mono font-medium text-foreground">{data.class.code}</span>.
        </CardContent>
      </Card>
    );
  }

  const skillNames = data.students[0].skills.map((s) => s.name);
  return (
    <Card>
      <CardContent className="overflow-x-auto p-0">
        <table className="w-full min-w-[56rem] text-sm">
          <thead className="border-b border-border text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">
                <button type="button" className="hover:text-foreground" onClick={() => setSort("name")}>
                  Student
                </button>
              </th>
              <th className="px-2 py-2 font-medium" title="Active days in the last 7 / 28 days">
                Active
              </th>
              <th className="px-2 py-2 font-medium">Min (7 d)</th>
              <th className="px-2 py-2 font-medium">
                <button type="button" className="hover:text-foreground" onClick={() => setSort("xp")}>
                  XP (7 d)
                </button>
              </th>
              <th className="px-2 py-2 font-medium">Streak</th>
              <th className="px-2 py-2 font-medium">Assignments</th>
              {skillNames.map((n) => (
                <th key={n} className="px-1.5 py-2 text-center font-medium" title={`${n} accuracy`}>
                  {n.slice(0, 4)}.
                </th>
              ))}
              <th className="px-2 py-2 font-medium">
                <button type="button" className="hover:text-foreground" onClick={() => setSort("behind")}>
                  Status
                </button>
              </th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {rows.map((s) => (
              <tr key={s.userId} className={cn(s.behind.length > 0 && "bg-amber-500/5")}>
                <td className="px-3 py-2">
                  <span className="block font-medium">{s.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {s.lastActiveDay ? `Last practised ${s.inactiveDays === 0 ? "today" : s.inactiveDays === 1 ? "yesterday" : `${s.inactiveDays} days ago`}` : "Not started"}
                    {!s.onClassCourse && s.level && " · on another course"}
                  </span>
                </td>
                <td className="px-2 py-2 tabular-nums">
                  {s.activeDays7} / {s.activeDays28}
                </td>
                <td className="px-2 py-2 tabular-nums">{s.minutes7}</td>
                <td className="px-2 py-2 tabular-nums">{s.xp7}</td>
                <td className="px-2 py-2">
                  <StreakBadge streak={s.streak} className="text-xs" />
                </td>
                <td className="px-2 py-2 tabular-nums">
                  {s.assignmentsDone} / {data.assignments.length}
                  {s.overdue > 0 && <span className="ml-1 text-xs text-red-600">({s.overdue} late)</span>}
                </td>
                {s.skills.map((k) => (
                  <td
                    key={k.name}
                    className={cn(
                      "px-1.5 py-2 text-center text-xs tabular-nums",
                      k.accuracy == null ? "text-muted-foreground" : k.accuracy >= 80 ? "text-emerald-600" : k.accuracy >= 60 ? "text-amber-600" : "text-red-600",
                    )}
                    title={`${k.name}: ${k.answers} answers`}
                  >
                    {k.accuracy == null ? "–" : `${k.accuracy}%`}
                  </td>
                ))}
                <td className="px-2 py-2 text-xs">
                  {s.behind.length === 0 ? (
                    <span className="inline-flex items-center gap-1 text-emerald-600">
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> On track
                    </span>
                  ) : (
                    <span className="inline-flex items-start gap-1 text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span>{s.behind.join(" · ")}</span>
                    </span>
                  )}
                </td>
                <td className="px-2 py-2 text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    aria-label={`Remove ${s.name} from the class`}
                    title="Remove from the class"
                    onClick={async () => {
                      const ok = await confirm({
                        title: `Remove ${s.name}?`,
                        description: "They leave the class; their own course and progress stay theirs.",
                        confirmLabel: "Remove",
                        destructive: true,
                      });
                      if (ok) await removeStudent.mutateAsync(s.userId);
                    }}
                  >
                    <UserMinus className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function AssignmentsPanel({ classId, data }: { classId: string; data: ClassDashboard }) {
  const [adding, setAdding] = useState(false);
  const del = useDeleteAssignment(classId);
  const confirm = useConfirm();
  const now = Date.now();
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button className="gap-1.5" onClick={() => setAdding(true)} disabled={data.class.courseStatus !== "READY"}>
          <Plus className="h-4 w-4" aria-hidden="true" /> Assign work
        </Button>
      </div>
      {data.assignments.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">No assignment yet. Assign a unit or a lesson with a due date; students see it first.</CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {data.assignments.map((a) => {
            const overdue = new Date(a.dueAt).getTime() < now;
            const pct = a.of ? Math.round((a.finished / a.of) * 100) : 0;
            return (
              <li key={a.id}>
                <Card>
                  <CardContent className="flex flex-wrap items-center gap-3 p-3">
                    <CalendarClock className={cn("h-5 w-5", overdue ? "text-red-600" : "text-primary")} aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{a.title}</p>
                      <p className="text-xs text-muted-foreground">
                        Due {new Date(a.dueAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })} · {a.lessons} lesson{a.lessons === 1 ? "" : "s"}
                        {a.note ? ` · ${a.note}` : ""}
                      </p>
                    </div>
                    <div className="w-40">
                      <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
                      </div>
                      <p className="mt-1 text-right text-xs tabular-nums text-muted-foreground">
                        {a.finished} of {a.of} finished
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      aria-label={`Delete ${a.title}`}
                      onClick={async () => {
                        if (await confirm({ title: "Delete this assignment?", description: a.title, confirmLabel: "Delete", destructive: true })) await del.mutateAsync(a.id);
                      }}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
      <AssignDialog classId={classId} open={adding} onOpenChange={setAdding} />
    </div>
  );
}

function AssignDialog({ classId, open, onOpenChange }: { classId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data: outline, isLoading } = useClassOutline(classId, open);
  const create = useCreateAssignment(classId);
  const [choice, setChoice] = useState<string>("");
  const [due, setDue] = useState(() => {
    const d = new Date(Date.now() + 7 * 86_400_000);
    d.setHours(18, 0, 0, 0);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  });
  const [note, setNote] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!choice) return;
    const [kind, value] = choice.split(":");
    try {
      const a = await create.mutateAsync({
        ...(kind === "unit" ? { unitIndex: Number(value) } : { lessonId: value }),
        dueAt: new Date(due).toISOString(),
        note: note.trim() || undefined,
      });
      toast.success(`Assigned: ${a.title}`);
      setChoice("");
      setNote("");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not assign");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Assign work</DialogTitle>
          <DialogDescription>A whole unit or one lesson of the class course. Students see it first on their PolyLingue home.</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(e) => void submit(e)}>
          {isLoading || !outline ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading the course…
            </p>
          ) : (
            <div className="scroll-thin max-h-72 space-y-2 overflow-y-auto rounded-md border border-border p-2" role="radiogroup" aria-label="What to assign">
              {outline.units.map((u) => (
                <div key={u.index}>
                  <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm font-medium hover:bg-muted">
                    <input type="radio" name="what" value={`unit:${u.index}`} checked={choice === `unit:${u.index}`} onChange={(e) => setChoice(e.target.value)} />
                    Unit {u.index + 1}: {u.title}
                    <span className="text-xs font-normal text-muted-foreground">({u.lessons.length} lessons)</span>
                  </label>
                  {u.lessons.map((l) => (
                    <label key={l.id} className="ml-6 flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted">
                      <input type="radio" name="what" value={`lesson:${l.id}`} checked={choice === `lesson:${l.id}`} onChange={(e) => setChoice(e.target.value)} />
                      {l.title}
                    </label>
                  ))}
                </div>
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="due">Due</Label>
              <Input id="due" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="note">Note (optional)</Label>
              <Input id="note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Before Friday's class" />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!choice || create.isPending}>
              Assign
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DifficultiesPanel({ classId, active }: { classId: string; active: boolean }) {
  const { data, isLoading, error } = useClassDifficulties(classId, active);
  const suggest = useSuggestActivities(classId);
  if (error) return <p className="text-sm text-destructive">{error.message}</p>;
  if (isLoading || !data) return <div className="h-48 animate-pulse rounded-lg bg-muted" />;
  const empty = data.words.length === 0 && data.exercises.length === 0 && data.grammar.length === 0;

  return (
    <div className="space-y-4">
      {empty ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">Nothing yet: difficulties appear once students have done some lessons.</CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardContent className="p-4">
              <h2 className="mb-2 text-sm font-semibold">Words forgotten most</h2>
              {data.words.length === 0 ? (
                <p className="text-sm text-muted-foreground">None yet.</p>
              ) : (
                <ul className="divide-y divide-border/60 text-sm">
                  {data.words.map((w) => (
                    <li key={`${w.term}-${w.translation}`} className="flex items-center gap-2 py-1.5">
                      <span className="font-medium">{w.term}</span>
                      <span className="text-muted-foreground">· {w.translation}</span>
                      <span className="ml-auto text-xs text-muted-foreground">
                        forgotten {w.lapses}× by {w.learners}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <h2 className="mb-2 text-sm font-semibold">Grammar with the lowest accuracy</h2>
              {data.grammar.length === 0 ? (
                <p className="text-sm text-muted-foreground">None yet.</p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {data.grammar.map((g) => (
                    <li key={g.unit} className="flex items-center gap-2">
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">{g.grammar}</span>
                        <span className="block text-xs text-muted-foreground">
                          Unit {g.unit}: {g.title}
                        </span>
                      </span>
                      <span className={cn("tabular-nums", g.accuracy >= 80 ? "text-emerald-600" : g.accuracy >= 60 ? "text-amber-600" : "text-red-600")}>{g.accuracy}%</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card className="md:col-span-2">
            <CardContent className="p-4">
              <h2 className="mb-2 text-sm font-semibold">Exercises missed most</h2>
              {data.exercises.length === 0 ? (
                <p className="text-sm text-muted-foreground">None yet.</p>
              ) : (
                <ul className="divide-y divide-border/60 text-sm">
                  {data.exercises.map((e, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-2 py-1.5">
                      <span className="min-w-0 flex-1">
                        {e.prompt} <span className="text-muted-foreground">→ {e.answer}</span>
                        <span className="block text-xs text-muted-foreground">{e.lesson}</span>
                      </span>
                      <Badge variant="outline" className="tabular-nums">
                        {e.wrongRate}% wrong · {e.answers}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Lightbulb className="h-4 w-4 text-amber-500" aria-hidden="true" /> Suggested in-class activities
            </h2>
            {data.activitiesAt && <span className="text-xs text-muted-foreground">written {new Date(data.activitiesAt).toLocaleString()}</span>}
            <Button
              size="sm"
              className="ml-auto gap-1.5"
              variant={data.activities ? "outline" : "default"}
              disabled={suggest.isPending || empty}
              onClick={() => suggest.mutateAsync().catch((e) => toast.error(e instanceof Error ? e.message : "Could not write activities"))}
            >
              {suggest.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
              {data.activities ? "Suggest again" : "Suggest activities"}
            </Button>
          </div>
          {data.activities ? (
            <ul className="grid gap-3 md:grid-cols-2">
              {data.activities.map((a, i) => (
                <li key={i} className="rounded-lg border border-border p-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{a.title}</span>
                    <Badge variant="secondary" className="text-[10px]">
                      {a.kind}
                    </Badge>
                    <span className="ml-auto text-xs text-muted-foreground">{a.minutes} min</span>
                  </div>
                  {a.targets && <p className="mt-1 text-xs text-muted-foreground">Works on: {a.targets}</p>}
                  <p className="mt-1.5 whitespace-pre-line text-sm">{a.instructions}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              The AI model writes role-plays, speaking, grammar and vocabulary activities from the words and grammar your class misses most.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
