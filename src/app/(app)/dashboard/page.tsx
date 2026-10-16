"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BookOpen,
  Boxes,
  CalendarClock,
  Compass,
  Languages,
  FileStack,
  Layers,
  Loader2,
  Plus,
  Settings2,
  type LucideIcon,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/misc";
import { JobProgressRow } from "@/components/shared/job-status";
import { useStudySets, useDeleteStudySet, useCreateStudySet } from "@/hooks/use-api";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { RelatedTopicsLine, RelatedTopicsMenu } from "@/components/shared/related-topics";
import { isMenuKey, menuPoint, type MenuPoint } from "@/components/shared/pointer-menu";
import type { StudySetSummary } from "@/hooks/use-api";
import { cn } from "@/lib/utils";

const LEVELS: { value: string; label: string }[] = [
  { value: "INTRODUCTORY", label: "Introductory" },
  { value: "ADVANCED_UNDERGRAD", label: "Advanced undergrad" },
  { value: "GRADUATE", label: "Graduate" },
];

export default function DashboardPage() {
  const router = useRouter();
  const { data: sets, isLoading } = useStudySets();
  const deleteSet = useDeleteStudySet();
  const confirm = useConfirm();
  const createSet = useCreateStudySet();
  const [quickOpen, setQuickOpen] = useState(false);
  // The selected course card, and its context menu (related topics).
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ set: StudySetSummary; at: MenuPoint } | null>(null);
  const openMenu = (set: StudySetSummary, at: MenuPoint) => {
    setSelectedId(set.id);
    setMenu({ set, at });
  };
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [level, setLevel] = useState("ADVANCED_UNDERGRAD");

  const activeJobs = (sets ?? []).flatMap((s) => s.activeJobs.map((j) => ({ ...j, setTitle: s.title })));
  const totalDue = (sets ?? []).reduce((n, s) => n + s.dueCards, 0);
  const readyToStudy = (sets ?? []).filter((s) => s.counts.sourcesReady > 0);

  async function quickCreate(e: React.FormEvent) {
    e.preventDefault();
    if (title.trim().length < 3) {
      toast.error("Give your study set a title (3+ characters)");
      return;
    }
    try {
      const res = await createSet.mutateAsync({
        title: title.trim(),
        subject: subject.trim() || undefined,
        learnerLevel: level,
        outputTypes: ["GUIDE", "FLASHCARDS", "QUIZ"],
      });
      toast.success("Study set created — add your sources");
      router.push(`/create?studySetId=${res.studySet.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create study set");
    }
  }

  async function onDelete(id: string, setTitle: string) {
    const ok = await confirm({
      title: "Delete this study set?",
      description: `"${setTitle}" and all its sources and generated material are deleted permanently. This cannot be undone.`,
      confirmLabel: "Delete permanently",
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteSet.mutateAsync(id);
      toast.success("Study set deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  }

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">Your study sets, processing jobs, and what&apos;s due today.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" className="gap-1.5">
            <Link href="/explore">
              <Compass className="h-4 w-4" aria-hidden="true" /> Explore
            </Link>
          </Button>
          <Button asChild variant="outline" className="gap-1.5">
            <Link href="/polylingue" title="Learn a foreign language, 10 minutes a day">
              <Languages className="h-4 w-4" aria-hidden="true" /> PolyLingue
            </Link>
          </Button>
          <Button onClick={() => setQuickOpen(true)} className="gap-1.5">
            <Plus className="h-4 w-4" aria-hidden="true" /> New study set
          </Button>
        </div>
      </div>

      {/* Stats row */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Boxes} label="Study sets" value={sets?.length} />
        <StatCard icon={FileStack} label="Sources processing" value={sets?.reduce((n, s) => n + s.counts.sourcesProcessing, 0)} />
        <StatCard icon={CalendarClock} label="Cards due now" value={totalDue} highlight={totalDue > 0} href={totalDue > 0 ? "#review" : undefined} />
        <StatCard icon={BookOpen} label="Ready to study" value={readyToStudy.length} />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        {/* Study set grid */}
        <section aria-label="Study sets" className="lg:col-span-2">
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">Study sets</h2>
          {isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Skeleton className="h-40" />
              <Skeleton className="h-40" />
            </div>
          ) : (sets ?? []).length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
                <div className="rounded-full bg-primary/10 p-3 text-primary">
                  <Layers className="h-6 w-6" aria-hidden="true" />
                </div>
                <div>
                  <p className="font-medium">No study sets yet</p>
                  <p className="mt-1 text-sm text-muted-foreground">Upload a lecture, paper, or notes to forge your first one.</p>
                </div>
                <Button asChild>
                  <Link href="/create">
                    <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> Create a study set
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {(sets ?? []).map((s) => (
                <Card
                  key={s.id}
                  className={cn(
                    "group relative transition-colors hover:border-primary/40",
                    selectedId === s.id && "border-primary/60 ring-2 ring-primary/30",
                  )}
                  data-selected={selectedId === s.id || undefined}
                  onClick={(e) => {
                    // A click on the card itself (not its link or buttons) selects it.
                    if (!(e.target as Element).closest("a, button")) setSelectedId(s.id);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    openMenu(s, menuPoint(e));
                  }}
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <Link
                        href={`/study-sets/${s.id}`}
                        className="min-w-0 flex-1"
                        data-set-link={s.id}
                        aria-haspopup="menu"
                        onKeyDown={(e) => {
                          if (isMenuKey(e)) {
                            e.preventDefault();
                            e.stopPropagation();
                            openMenu(s, menuPoint(e));
                          }
                        }}
                      >
                        <CardTitle className="truncate text-base leading-snug hover:text-primary">{s.title}</CardTitle>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {[s.course, s.subject].filter(Boolean).join(" · ") || "No course set"}
                        </p>
                        {s.classification && (
                          <p
                            className="mt-0.5 truncate text-xs text-muted-foreground"
                            title={`${s.classification.discipline.name} › ${s.classification.subject.name} › ${s.classification.module.name} › ${s.classification.topic.name}`}
                          >
                            {s.classification.module.name} › <span className="text-foreground">{s.classification.topic.name}</span>
                          </p>
                        )}
                      </Link>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Delete ${s.title}`}
                        className="h-7 w-7 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                        onClick={() => void onDelete(s.id, s.title)}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {s.activeJobs.length > 0 && (
                      <div className="mb-2">
                        <JobProgressRow job={s.activeJobs[0]} />
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <Badge variant="secondary">{s.counts.sourcesReady}/{s.counts.sources} sources</Badge>
                      {s.counts.decks > 0 && <Badge variant="secondary">{s.counts.decks} decks</Badge>}
                      {s.counts.quizzes > 0 && <Badge variant="secondary">{s.counts.quizzes} quizzes</Badge>}
                      {s.counts.exerciseSets > 0 && <Badge variant="secondary">{s.counts.exerciseSets} exercise sets</Badge>}
                      {s.dueCards > 0 && (
                        <Badge variant="citation">{s.dueCards} due</Badge>
                      )}
                    </div>
                    <RelatedTopicsLine related={s.related} className="mt-2" />
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* Right rail: jobs + review queue */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Loader2 className={`h-3.5 w-3.5 ${activeJobs.length ? "animate-spin text-primary" : "text-muted-foreground"}`} aria-hidden="true" />
                Processing
              </CardTitle>
            </CardHeader>
            <CardContent>
              {activeJobs.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing in the forge right now.</p>
              ) : (
                <div className="divide-y divide-border/70">
                  {activeJobs.slice(0, 6).map((j, i) => (
                    <div key={j.id ?? `${j.studySetId}-${i}`}>
                      <p className="mb-0.5 truncate text-xs text-muted-foreground">{j.setTitle}</p>
                      <JobProgressRow job={j} />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card id="review">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Review queue</CardTitle>
            </CardHeader>
            <CardContent>
              {totalDue === 0 ? (
                <p className="text-sm text-muted-foreground">No cards due. Generate flashcards from a study set to start scheduling.</p>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm">
                    <span className="text-2xl font-semibold tabular-nums">{totalDue}</span>{" "}
                    <span className="text-muted-foreground">cards due across your sets</span>
                  </p>
                  {(sets ?? [])
                    .filter((s) => s.dueCards > 0)
                    .map((s) => (
                      <Link
                        key={s.id}
                        href={`/study-sets/${s.id}/flashcards`}
                        className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:border-primary/40"
                      >
                        <span className="min-w-0 flex-1 truncate">{s.title}</span>
                        <Badge variant="citation">{s.dueCards} due</Badge>
                      </Link>
                    ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Progress</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(sets ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">Progress will appear once you start studying.</p>
              ) : (
                (sets ?? []).slice(0, 4).map((s) => {
                  const ready = s.counts.sources === 0 ? 0 : Math.round((s.counts.sourcesReady / s.counts.sources) * 100);
                  return (
                    <div key={s.id}>
                      <Link href={`/study-sets/${s.id}/analytics`} className="flex items-center justify-between text-xs hover:text-primary">
                        <span className="min-w-0 flex-1 truncate">{s.title}</span>
                        <span className="tabular-nums text-muted-foreground">{ready}% indexed</span>
                      </Link>
                      <Progress value={ready} className="mt-1 h-1.5" />
                    </div>
                  );
                })
              )}
              <p className="flex items-center gap-1.5 pt-1 text-xs text-muted-foreground">
                <Settings2 className="h-3 w-3" aria-hidden="true" />
                Detailed mastery analytics live in each study set.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Quick-create modal */}
      <RelatedTopicsMenu target={menu} onClose={() => setMenu(null)} />

      <Dialog open={quickOpen} onOpenChange={setQuickOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New study set</DialogTitle>
            <DialogDescription>Name it now — the next step lets you upload sources.</DialogDescription>
          </DialogHeader>
          <form onSubmit={quickCreate} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="qs-title">Title</Label>
              <Input id="qs-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Lecture 7 — Backpropagation" autoFocus />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="qs-subject">Keywords (optional)</Label>
                <Input id="qs-subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Machine learning" />
              </div>
              <div className="space-y-1.5">
                <Label>Level</Label>
                <Select value={level} onValueChange={setLevel}>
                  <SelectTrigger aria-label="Learner level">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LEVELS.map((l) => (
                      <SelectItem key={l.value} value={l.value}>
                        {l.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setQuickOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createSet.isPending}>
                {createSet.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                Create & add sources
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  highlight,
  href,
}: {
  icon: LucideIcon;
  label: string;
  value?: number;
  highlight?: boolean;
  href?: string;
}) {
  const body = (
    <Card className={highlight ? "border-primary/40" : undefined}>
      <CardContent className="flex items-center gap-3 py-4">
        <div className={`rounded-lg p-2 ${highlight ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </div>
        <div>
          <p className="text-xl font-semibold tabular-nums leading-none">{value ?? <span className="text-muted-foreground">—</span>}</p>
          <p className="mt-1 text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
  return href ? (
    <a href={href} className="block transition-transform hover:-translate-y-0.5">
      {body}
    </a>
  ) : (
    body
  );
}
