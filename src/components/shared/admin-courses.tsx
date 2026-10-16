"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRightLeft, Bot, Compass, Loader2, Search, Trash2, TriangleAlert, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAdminDeleteStudySet, useAdminStudySets, useAdminUsers, useTransferStudySet, type AdminStudySetRow } from "@/hooks/use-api";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { ClassificationPath, ClassifyButton } from "@/components/shared/topic-picker";

const who = (u: { name: string | null; email: string }) => u.name || u.email;

/** A course without any source has nothing to study from. */
const isEmpty = (s: AdminStudySetRow) => s._count.sources === 0;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Courses of Human accounts first, then Bot accounts; within each, by owner, then newest first. */
function groupByOwner(rows: AdminStudySetRow[]): { nature: "HUMAN" | "BOT"; rows: AdminStudySetRow[] }[] {
  const byOwner = (a: AdminStudySetRow, b: AdminStudySetRow) =>
    who(a.owner).localeCompare(who(b.owner), undefined, { sensitivity: "base" }) ||
    a.owner.email.localeCompare(b.owner.email) ||
    b.createdAt.localeCompare(a.createdAt);
  return (["HUMAN", "BOT"] as const).map((nature) => ({
    nature,
    rows: rows.filter((r) => r.owner.nature === nature).sort(byOwner),
  }));
}

/**
 * Courses tab: every study set with the one account it belongs to, and
 * "Change owner" to give a study set to another account.
 */
export function AdminCourses() {
  const { data, isLoading, error } = useAdminStudySets();
  const [query, setQuery] = useState("");
  const [moving, setMoving] = useState<AdminStudySetRow | null>(null);
  const remove = useAdminDeleteStudySet();
  const confirm = useConfirm();
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const empties = useMemo(() => (data?.studySets ?? []).filter(isEmpty), [data]);

  async function deleteCourses(courses: AdminStudySetRow[]) {
    setDeletingIds(new Set(courses.map((c) => c.id)));
    let sets = 0;
    try {
      for (const c of courses) {
        await remove.mutateAsync(c.id);
        sets++;
      }
      toast.success(sets === 1 ? `"${courses[0].title}" deleted` : `${sets} courses deleted`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeletingIds(new Set());
    }
  }

  async function onDelete(s: AdminStudySetRow) {
    const generated = `${plural(s._count.guides, "guide")}, ${plural(s._count.decks, "deck")}, ${plural(s._count.quizzes, "quiz")}`;
    const hasGenerated = s._count.guides + s._count.decks + s._count.quizzes + s._count.exerciseSets > 0;
    const content = isEmpty(s)
      ? `It has no sources${hasGenerated ? `; its leftover generated material (${generated}) is deleted too` : ""}.`
      : `Its ${plural(s._count.sources, "source")}, generated material (${generated}), stored files and everyone's progress are deleted too.`;
    const ok = await confirm({
      title: "Delete this course?",
      description: `"${s.title}" (owner: ${who(s.owner)}) is deleted permanently. ${content}${s.busy ? " A running import or generation will stop." : ""} This cannot be undone.`,
      confirmLabel: "Delete course",
      destructive: true,
    });
    if (ok) await deleteCourses([s]);
  }

  async function onDeleteEmpties() {
    const names = empties.slice(0, 5).map((s) => `"${s.title}"`).join(", ");
    const more = empties.length > 5 ? ` and ${empties.length - 5} more` : "";
    const ok = await confirm({
      title: `Delete ${plural(empties.length, "empty course")}?`,
      description: `${names}${more} — ${empties.length === 1 ? "it has" : "they have"} no sources. Any generated material left in ${empties.length === 1 ? "it" : "them"} is deleted too. This cannot be undone.`,
      confirmLabel: `Delete ${plural(empties.length, "course")}`,
      destructive: true,
    });
    if (ok) await deleteCourses(empties);
  }

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = data?.studySets ?? [];
    if (!q) return all;
    return all.filter((s) =>
      [
        s.title,
        s.subject,
        s.course,
        s.owner.name,
        s.owner.email,
        ...(s.classification ? [s.classification.discipline, s.classification.subject, s.classification.module, s.classification.topic].map((l) => l.name) : []),
      ].some((v) => v?.toLowerCase().includes(q)),
    );
  }, [data, query]);
  const groups = useMemo(() => groupByOwner(rows), [rows]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Courses</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Every study set and the account it belongs to. A study set belongs to exactly one account.
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
        <Button asChild variant="outline" size="sm" className="gap-1.5">
          <Link href="/explore?scope=all">
            <Compass className="h-3.5 w-3.5" aria-hidden="true" /> Explore
          </Link>
        </Button>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search courses or owners"
            aria-label="Search courses or owners"
            className="pl-8"
          />
        </div>
        </div>
      </div>

      {empties.length > 0 && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <span className="flex items-center gap-2">
            <TriangleAlert className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
            {empties.length === 1
              ? `"${empties[0].title}" is empty (no sources). Delete it?`
              : `${empties.length} courses are empty (no sources). Delete them?`}
          </span>
          <Button size="sm" variant="outline" onClick={() => void onDeleteEmpties()} disabled={remove.isPending}>
            <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Delete {empties.length === 1 ? "empty course" : `${empties.length} empty courses`}
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="h-40 animate-pulse rounded-lg bg-muted" />
      ) : error ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-destructive">{error.message}</CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <caption className="sr-only">Courses and their owners</caption>
              <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Course</th>
                  <th scope="col" className="px-4 py-3 font-medium">Owner</th>
                  <th scope="col" className="px-4 py-3 font-medium">Content</th>
                  <th scope="col" className="px-4 py-3 font-medium">Created</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                      {query ? "No course matches this search." : "No study sets yet."}
                    </td>
                  </tr>
                ) : (
                  groups.flatMap((group) => [
                    // Group heading: splits Human accounts' courses from Bot accounts' courses.
                    <tr key={`group-${group.nature}`} className="border-b border-border bg-muted/50">
                      <th scope="colgroup" colSpan={5} className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        <span className="inline-flex items-center gap-1.5">
                          {group.nature === "HUMAN" ? (
                            <UserRound className="h-3.5 w-3.5" aria-hidden="true" />
                          ) : (
                            <Bot className="h-3.5 w-3.5" aria-hidden="true" />
                          )}
                          {group.nature === "HUMAN" ? "Human accounts" : "Bot accounts"} · {group.rows.length}
                        </span>
                      </th>
                    </tr>,
                    ...(group.rows.length === 0
                      ? [
                          <tr key={`empty-${group.nature}`} className="border-b border-border/60">
                            <td colSpan={5} className="px-4 py-3 text-xs text-muted-foreground">
                              No courses.
                            </td>
                          </tr>,
                        ]
                      : group.rows.map((s) => (
                    <tr key={s.id} className="border-b border-border/60 last:border-0">
                      <td className="px-4 py-3">
                        <Link href={`/study-sets/${s.id}`} className="font-medium hover:underline">
                          {s.title}
                        </Link>
                        {(s.subject || s.course) && (
                          <p className="text-xs text-muted-foreground">{[s.course, s.subject].filter(Boolean).join(" · ")}</p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          {s.classification ? <ClassificationPath classification={s.classification} /> : <span className="italic">No topic</span>}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium">{who(s.owner)}</p>
                        {s.owner.name && <p className="text-xs text-muted-foreground">{s.owner.email}</p>}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {s._count.sources} sources · {s._count.guides} guide{s._count.guides === 1 ? "" : "s"} · {s._count.decks} decks ·{" "}
                        {s._count.quizzes} quizzes
                        {s.busy && (
                          <Badge variant="secondary" className="ml-2 text-[10px]">
                            working
                          </Badge>
                        )}
                        {isEmpty(s) && (
                          <Badge variant="outline" className="ml-2 border-amber-500/50 text-[10px] text-amber-700 dark:text-amber-400">
                            Empty
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{new Date(s.createdAt).toLocaleDateString()}</td>
                      <td className="whitespace-nowrap px-2 py-3 text-right">
                        <ClassifyButton studySetId={s.id} title={s.title} topicId={s.classification?.topicId ?? null} label="Topic" />
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1.5"
                          onClick={() => setMoving(s)}
                          disabled={s.busy}
                          title={s.busy ? "An import or generation is running" : undefined}
                          aria-label={`Change owner of ${s.title}`}
                        >
                          <ArrowRightLeft className="h-3.5 w-3.5" aria-hidden="true" /> Change owner
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => void onDelete(s)}
                          disabled={deletingIds.has(s.id)}
                          title="Delete course"
                          aria-label={`Delete ${s.title}`}
                        >
                          {deletingIds.has(s.id) ? (
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                          ) : (
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          )}
                        </Button>
                      </td>
                    </tr>
                  ))),
                  ])
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <ChangeOwnerDialog studySet={moving} onClose={() => setMoving(null)} />
    </div>
  );
}

function ChangeOwnerDialog({ studySet, onClose }: { studySet: AdminStudySetRow | null; onClose: () => void }) {
  const { data } = useAdminUsers();
  const transfer = useTransferStudySet();
  const [userId, setUserId] = useState("");
  const [openedFor, setOpenedFor] = useState<string | null>(null);

  // Reset the choice whenever the dialog opens for another course.
  if ((studySet?.id ?? null) !== openedFor) {
    setOpenedFor(studySet?.id ?? null);
    setUserId("");
  }

  const candidates = (data?.users ?? []).filter((u) => u.id !== studySet?.owner.id);
  const target = candidates.find((u) => u.id === userId);

  async function onConfirm() {
    if (!studySet || !target) return;
    try {
      const res = await transfer.mutateAsync({ studySetId: studySet.id, userId: target.id });
      toast.success(`"${studySet.title}" now belongs to ${who(target)} (${res.filesMoved} files moved)`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not change the owner");
    }
  }

  return (
    <Dialog open={studySet !== null} onOpenChange={(open) => !open && !transfer.isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change owner</DialogTitle>
          <DialogDescription>
            Give &ldquo;{studySet?.title}&rdquo; to another account. Its sources, files, guide, cards, quizzes and the current
            owner&apos;s progress move with it, and {studySet ? who(studySet.owner) : "the current owner"} loses access.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="new-owner">New owner</Label>
          <Select value={userId} onValueChange={setUserId}>
            <SelectTrigger id="new-owner">
              <SelectValue placeholder="Choose an account" />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name ? `${u.name} — ${u.email}` : u.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={transfer.isPending}>
            Cancel
          </Button>
          <Button onClick={() => void onConfirm()} disabled={!target || transfer.isPending}>
            {transfer.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
            Change owner
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
