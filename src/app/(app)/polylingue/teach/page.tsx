"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { ChevronRight, Loader2, Plus, School, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LangBadge } from "@/components/polylingue/lang-badge";
import { canTeach } from "@/lib/admin";
import { BASE_LANGUAGES, CEFR_LEVELS, LEVELS, TARGET_LANGUAGES, isImmersion, targetLanguage, type Cefr } from "@/lib/polylingue/levels";
import { useCreateClass, useTeacherClasses } from "@/hooks/use-polylingue";

const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Teachers' classes (TEACHER role, given by an administrator). */
export default function TeachPage() {
  const { data: session, status } = useSession();
  const teacher = canTeach(session?.user?.role);
  const { data, isLoading, error } = useTeacherClasses(teacher);
  const [creating, setCreating] = useState(false);

  if (status === "loading") return <div className="mx-auto mt-6 h-48 max-w-3xl animate-pulse rounded-lg bg-muted" />;
  if (!teacher) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
        <Card>
          <CardContent className="space-y-2 p-6 text-sm">
            <h1 className="flex items-center gap-2 text-lg font-semibold">
              <School className="h-5 w-5 text-primary" aria-hidden="true" /> Teaching
            </h1>
            <p className="text-muted-foreground">
              Classes are run by teachers. An administrator gives the Teacher role (Admin › Users). To join a class as a student, use{" "}
              <Link href="/polylingue/classes" className="text-primary hover:underline">
                My classes
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <School className="h-5 w-5 text-primary" aria-hidden="true" /> My classes
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Each class follows one course; students join with its code. You see only your own classes.</p>
        </div>
        <Button className="gap-1.5" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" aria-hidden="true" /> New class
        </Button>
      </div>

      {error ? (
        <p className="text-sm text-destructive">{error.message}</p>
      ) : isLoading || !data ? (
        <div className="h-40 animate-pulse rounded-lg bg-muted" />
      ) : data.classes.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">No class yet. Create one, then share its code with your students.</CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {data.classes.map((c) => (
            <li key={c.id}>
              <Link href={`/polylingue/teach/${c.id}`} className="block rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted/40">
                <div className="flex flex-wrap items-center gap-3">
                  <LangBadge code={c.targetLang} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{c.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {targetLanguage(c.targetLang)?.name} {c.level} · {c.weeklyMinutes} min a week · code <span className="font-mono">{c.code}</span>
                    </p>
                  </div>
                  <span className="flex items-center gap-1 text-sm text-muted-foreground">
                    <Users className="h-4 w-4" aria-hidden="true" /> {c.students}
                  </span>
                  <Badge variant="secondary">{c.assignments} assignments</Badge>
                  {(c.courseStatus === "QUEUED" || c.courseStatus === "GENERATING") && (
                    <Badge variant="outline" className="gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> course being written
                    </Badge>
                  )}
                  <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <CreateClassDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}

function CreateClassDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const create = useCreateClass();
  const [name, setName] = useState("");
  const [targetLang, setTarget] = useState("es");
  const [baseLang, setBase] = useState("en");
  const [level, setLevel] = useState<Cefr>("A1");
  const [weeklyMinutes, setWeekly] = useState(60);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      const c = await create.mutateAsync({ name: name.trim(), targetLang, baseLang, level, weeklyMinutes });
      toast.success(`Class created: share the code ${c.code} with your students.`);
      onOpenChange(false);
      router.push(`/polylingue/teach/${c.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the class");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New class</DialogTitle>
          <DialogDescription>The class follows the shared course for this language and level. Students who join switch their course in this language to it.</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(e) => void submit(e)}>
          <div className="space-y-1.5">
            <Label htmlFor="class-name">Name</Label>
            <Input id="class-name" value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={60} required placeholder="Spanish 2B" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="class-target">Language taught</Label>
              <select id="class-target" className={selectClass} value={targetLang} onChange={(e) => setTarget(e.target.value)}>
                {TARGET_LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="class-level">Level</Label>
              <select id="class-level" className={selectClass} value={level} onChange={(e) => setLevel(e.target.value as Cefr)}>
                {CEFR_LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {l} · {LEVELS[l].name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="class-base">Explanations in</Label>
              <select id="class-base" className={selectClass} value={baseLang} onChange={(e) => setBase(e.target.value)} disabled={isImmersion(level)}>
                {BASE_LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.name}
                  </option>
                ))}
              </select>
              {isImmersion(level) && <p className="text-[11px] text-muted-foreground">From B2, everything is in the language taught.</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="class-weekly">Minutes a week</Label>
              <Input id="class-weekly" type="number" min={10} max={600} step={5} value={weeklyMinutes} onChange={(e) => setWeekly(Number(e.target.value))} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Below the weekly minutes, or after 3 days without practice, a student shows as falling behind.</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending} className="gap-1.5">
              {create.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Create the class
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
