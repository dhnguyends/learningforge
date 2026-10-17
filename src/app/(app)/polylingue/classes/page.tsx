"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClock, CheckCircle2, Crown, Loader2, LogOut, Play, School, Trophy, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/misc";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { LangBadge } from "@/components/polylingue/lang-badge";
import { cn } from "@/lib/utils";
import { BASE_LANGUAGES, targetLanguage } from "@/lib/polylingue/levels";
import { previewJoinClass, useClassLeague, useJoinClass, useLeaveClass, useMyClasses, type JoinPreview, type MyClass } from "@/hooks/use-polylingue";

/** The student's classes: join with a code, assignments, the class league (opt-in), leave. */
export default function MyClassesPage() {
  const { data, isLoading, error } = useMyClasses();
  const [joining, setJoining] = useState(false);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <School className="h-5 w-5 text-primary" aria-hidden="true" /> My classes
          </h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Your teacher sees your activity in the class language (time, XP, streak, assignments, accuracy). Classmates see only what you share in the class league.
          </p>
        </div>
        <Button className="gap-1.5" onClick={() => setJoining(true)}>
          <UserPlus className="h-4 w-4" aria-hidden="true" /> Join a class
        </Button>
      </div>

      {error ? (
        <p className="text-sm text-destructive">{error.message}</p>
      ) : isLoading || !data ? (
        <div className="h-40 animate-pulse rounded-lg bg-muted" />
      ) : data.classes.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">You are in no class. Ask your teacher for the class code.</CardContent>
        </Card>
      ) : (
        data.classes.map((c) => <ClassCard key={c.id} c={c} />)
      )}

      <JoinDialog open={joining} onOpenChange={setJoining} />
    </div>
  );
}

const STATE = {
  done: { label: "Done", className: "bg-emerald-600 text-white hover:bg-emerald-600" },
  late: { label: "Done late", className: "bg-emerald-600/70 text-white hover:bg-emerald-600/70" },
  todo: { label: "To do", className: "" },
  overdue: { label: "Overdue", className: "bg-red-600 text-white hover:bg-red-600" },
} as const;

function ClassCard({ c }: { c: MyClass }) {
  const leave = useLeaveClass();
  const league = useClassLeague(c.id);
  const confirm = useConfirm();
  const [nickname, setNickname] = useState(c.nickname ?? "");

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <LangBadge code={c.targetLang} />
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold">{c.name}</h2>
            <p className="text-xs text-muted-foreground">
              {c.teacher} · {targetLanguage(c.targetLang)?.name} {c.level}
              {!c.onClassCourse && " · your course is on another level: rejoin to follow the class"}
            </p>
          </div>
          {c.courseId && (
            <Button asChild size="sm" variant="outline">
              <Link href={`/polylingue/${c.courseId}`}>Open the course</Link>
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-muted-foreground"
            onClick={async () => {
              const ok = await confirm({ title: `Leave “${c.name}”?`, description: "Your course and progress stay yours. You can join again with the code.", confirmLabel: "Leave", destructive: true });
              if (ok) await leave.mutateAsync(c.id);
            }}
          >
            <LogOut className="h-4 w-4" aria-hidden="true" /> Leave
          </Button>
        </div>

        <div>
          <h3 className="mb-2 text-sm font-semibold">Assignments</h3>
          {c.assignments.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing assigned yet.</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {c.assignments.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                  {a.state === "done" || a.state === "late" ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden="true" />
                  ) : (
                    <CalendarClock className={cn("h-5 w-5", a.state === "overdue" ? "text-red-600" : "text-primary")} aria-hidden="true" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{a.title}</span>
                    <span className="block text-xs text-muted-foreground">
                      Due {new Date(a.dueAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })} · {a.done} of {a.total} lesson{a.total === 1 ? "" : "s"}
                      {a.note ? ` · ${a.note}` : ""}
                    </span>
                  </span>
                  <Badge variant={a.state === "todo" ? "outline" : "default"} className={STATE[a.state].className}>
                    {STATE[a.state].label}
                  </Badge>
                  {a.nextLessonId && c.courseId && (
                    <Button asChild size="sm" className="h-8 gap-1">
                      <Link href={`/polylingue/${c.courseId}/lesson/${a.nextLessonId}`}>
                        <Play className="h-3.5 w-3.5" aria-hidden="true" /> Start
                      </Link>
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-2 rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Trophy className="h-4 w-4 text-amber-500" aria-hidden="true" />
            <h3 className="text-sm font-semibold">Class league</h3>
            <span className="text-xs text-muted-foreground">This week&apos;s XP in {targetLanguage(c.targetLang)?.name}, among classmates who join it</span>
          </div>
          {c.inLeague ? (
            <>
              <ol className="divide-y divide-border/60 text-sm">
                {c.league?.map((r) => (
                  <li key={r.memberId} className={cn("flex items-center gap-3 px-2 py-1.5", r.you && "rounded bg-primary/5 font-medium")}>
                    <span className="w-6 text-center tabular-nums text-muted-foreground">
                      {r.rank === 1 && r.xp > 0 ? <Crown className="mx-auto h-4 w-4 text-amber-500" aria-label="First" /> : r.rank}
                    </span>
                    <span className="flex-1">
                      {r.nickname}
                      {r.you && <span className="ml-1 text-xs text-muted-foreground">(you)</span>}
                    </span>
                    <span className="tabular-nums">{r.xp} XP</span>
                  </li>
                ))}
              </ol>
              <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => void league.mutateAsync({ inLeague: false })}>
                Leave the class league
              </Button>
            </>
          ) : (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await league.mutateAsync({ inLeague: true, nickname: nickname.trim() });
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Could not join the league");
                }
              }}
            >
              <div className="space-y-1">
                <Label htmlFor={`nick-${c.id}`} className="text-xs">
                  Nickname shown to classmates
                </Label>
                <Input id={`nick-${c.id}`} value={nickname} onChange={(e) => setNickname(e.target.value)} minLength={2} maxLength={24} required className="h-8 w-44" />
              </div>
              <Button type="submit" size="sm" disabled={league.isPending}>
                Join the class league
              </Button>
            </form>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function JoinDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const join = useJoinClass();
  const [code, setCode] = useState("");
  const [preview, setPreview] = useState<JoinPreview | null>(null);
  const [checking, setChecking] = useState(false);

  const close = () => {
    setCode("");
    setPreview(null);
    onOpenChange(false);
  };

  async function check(e: React.FormEvent) {
    e.preventDefault();
    setChecking(true);
    try {
      setPreview(await previewJoinClass(code));
    } catch (err) {
      toast.error(err instanceof Error && /not found/i.test(err.message) ? "No class has this code." : err instanceof Error ? err.message : "Could not check the code");
    } finally {
      setChecking(false);
    }
  }

  async function confirmJoin() {
    try {
      const r = await join.mutateAsync({ code, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" });
      toast.success(`You joined “${preview?.name}”.`);
      close();
      router.push(`/polylingue/${r.courseId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not join");
    }
  }

  const lang = preview ? targetLanguage(preview.targetLang)?.name : "";
  const base = preview ? BASE_LANGUAGES.find((b) => b.code === preview.baseLang)?.name ?? lang : "";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Join a class</DialogTitle>
          <DialogDescription>Type the code your teacher gave you.</DialogDescription>
        </DialogHeader>
        {!preview ? (
          <form className="space-y-3" onSubmit={(e) => void check(e)}>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="K7Q-2MX"
              aria-label="Class code"
              className="font-mono uppercase tracking-widest"
              required
              autoComplete="off"
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" disabled={checking || code.replace(/[^A-Za-z0-9]/g, "").length < 6}>
                {checking && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
                Continue
              </Button>
            </div>
          </form>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-3 rounded-lg border border-border p-3">
              <LangBadge code={preview.targetLang} />
              <div>
                <p className="font-medium">{preview.name}</p>
                <p className="text-xs text-muted-foreground">
                  {preview.teacher} · {lang} {preview.level} · {preview.students} student{preview.students === 1 ? "" : "s"}
                </p>
              </div>
            </div>
            {preview.alreadyMember ? (
              <p className="text-muted-foreground">You are already in this class.</p>
            ) : (
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                <li>
                  {preview.currentCourse?.changes
                    ? `Your ${lang} course moves from ${preview.currentCourse.level} to the class level, ${preview.level}, with explanations in ${base}. Your XP, words and streak stay.`
                    : preview.currentCourse
                      ? `Your ${lang} course already follows this level.`
                      : `${/^[AEIOU]/i.test(lang ?? "") ? "An" : "A"} ${lang} ${preview.level} course is started for you, with explanations in ${base}.`}
                </li>
                <li>Your teacher sees your activity in {lang}: time, XP, streak, assignments and accuracy.</li>
              </ul>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setPreview(null)}>
                Back
              </Button>
              {!preview.alreadyMember && (
                <Button onClick={() => void confirmJoin()} disabled={join.isPending}>
                  {join.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
                  Join the class
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
