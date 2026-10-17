"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { BASE_LANGUAGES, LEVELS, isImmersion, targetLanguage, type Cefr } from "@/lib/polylingue/levels";
import { useLevelOptions, useUpdateCourse } from "@/hooks/use-polylingue";

/**
 * Change level for the same language: the course moves to the shared course
 * of the chosen level (written by the AI model first if nobody has started
 * it yet); XP, words, streak and badges are kept.
 */
export function ChangeLevelDialog({ courseId, open, onOpenChange }: { courseId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const { data, isLoading, error } = useLevelOptions(open ? courseId : null);
  const update = useUpdateCourse(courseId);
  const [level, setLevel] = useState<Cefr | null>(null);
  const [base, setBase] = useState<string>("en");

  useEffect(() => {
    if (!data) return;
    setLevel(data.level as Cefr);
    // Explanations stay in the learner's language; a course taught in its own language (B2+) falls back to the first other one.
    setBase(data.baseLang !== data.targetLang ? data.baseLang : (BASE_LANGUAGES.find((b) => b.code !== data.targetLang)?.code ?? "en"));
  }, [data]);

  const lang = data ? (targetLanguage(data.targetLang)?.name ?? data.targetLang) : "";
  const chosen = data?.levels.find((l) => l.level === level);
  const needsBase = level !== null && !isImmersion(level);
  const willWrite = chosen?.status === "NEW";
  const inClass = data?.classes.find((c) => c.current);

  async function confirm() {
    if (!data || !level || level === data.level) return onOpenChange(false);
    try {
      await update.mutateAsync({ level, ...(needsBase ? { baseLang: base } : {}) });
      toast.success(
        chosen?.status === "READY" ? `Your ${lang} course is now ${level}.` : `Writing the ${level} ${lang} course with the AI model (about a minute); it opens when ready.`,
      );
      onOpenChange(false);
      router.push(`/polylingue/${courseId}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not change the level");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Change level{lang ? ` · ${lang}` : ""}</DialogTitle>
          <DialogDescription>Your XP, words, streak and badges stay. The course of the new level is shared by every learner at that level.</DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="text-sm text-destructive">{error.message}</p>
        ) : isLoading || !data ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading the levels…
          </p>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5" role="radiogroup" aria-label="Level">
              {data.levels.map((l) => (
                <label
                  key={l.level}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-md border p-2.5 text-sm",
                    level === l.level ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:bg-muted/50",
                  )}
                >
                  <input type="radio" name="level" value={l.level} checked={level === l.level} onChange={() => setLevel(l.level)} className="sr-only" />
                  <span className="w-8 font-mono font-semibold">{l.level}</span>
                  <span className="min-w-0 flex-1">
                    {LEVELS[l.level].name}
                    {isImmersion(l.level) && <span className="block text-xs text-muted-foreground">taught in {lang}</span>}
                  </span>
                  {l.current ? (
                    <Badge variant="secondary">current</Badge>
                  ) : l.status === "READY" ? (
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> ready
                    </span>
                  ) : l.status === "QUEUED" || l.status === "GENERATING" ? (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> being written
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> written for you
                    </span>
                  )}
                </label>
              ))}
            </div>

            {needsBase && (
              <div className="space-y-1.5">
                <Label htmlFor="change-base">Explanations in</Label>
                <select
                  id="change-base"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={base}
                  onChange={(e) => setBase(e.target.value)}
                >
                  {BASE_LANGUAGES.filter((b) => b.code !== data.targetLang).map((b) => (
                    <option key={b.code} value={b.code}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {willWrite && level !== data.level && (
              <p className="rounded-md bg-muted/60 p-2 text-xs text-muted-foreground">
                Nobody has started the {level} {lang} course yet: the AI model writes it now (about a minute), then every lesson the first time it is opened.
              </p>
            )}
            {inClass && level !== data.level && (
              <p className="rounded-md bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-300">
                Your class “{inClass.name}” follows the {inClass.level} course: your teacher&apos;s assignments are on that level. Joining the class again brings you back to it.
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={() => void confirm()} disabled={!level || level === data.level || update.isPending} className="gap-1.5">
                {update.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                {level && level !== data.level ? `Switch to ${level}` : "Choose a level"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
