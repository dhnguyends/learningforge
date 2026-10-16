"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Circle, FileText, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useCreateSourceLesson, useEligibleSources, useSourceParts, type CourseDetail } from "@/hooks/use-polylingue";

/**
 * Learn from your own material: pick one of your LearningForge sources that
 * exists in the language you learn (originally or through its translation),
 * then a part of it; it becomes a personal lesson at your level.
 */
export function SourceLessons({ course }: { course: CourseDetail }) {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <FileText className="h-4 w-4 text-primary" aria-hidden="true" /> Learn from your own material
            </h2>
            <p className="text-xs text-muted-foreground">Turn a lecture, a document or a video from your study sets into a lesson at your {course.level} level.</p>
          </div>
          <Button size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
            <Sparkles className="h-4 w-4" aria-hidden="true" /> Make a lesson
          </Button>
        </div>
        {course.sourceLessons.length > 0 && (
          <ul className="divide-y divide-border/60">
            {course.sourceLessons.map((l) => (
              <li key={l.id}>
                <Link href={`/polylingue/${course.id}/lesson/${l.id}`} className="flex items-center gap-3 rounded-md px-2 py-2.5 text-sm hover:bg-muted/50">
                  {l.completed ? (
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" aria-label="Completed" />
                  ) : (
                    <Circle className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{l.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {l.failed ? "Could not be written: open it to try again" : l.ready ? `From ${l.source}` : "Being written…"}
                    </span>
                  </span>
                  {!l.ready && !l.failed && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />}
                  {l.completed && <span className="text-xs tabular-nums text-muted-foreground">{l.bestScore}%</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <SourcePicker course={course} open={open} onOpenChange={setOpen} />
    </Card>
  );
}

function SourcePicker({ course, open, onOpenChange }: { course: CourseDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const { data, isLoading, error } = useEligibleSources(course.id, open);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const { data: parts, isLoading: partsLoading } = useSourceParts(course.id, sourceId);
  const [part, setPart] = useState(0);
  const create = useCreateSourceLesson(course.id);

  async function make() {
    if (!sourceId) return;
    try {
      const { id } = await create.mutateAsync({ sourceId, part });
      onOpenChange(false);
      router.push(`/polylingue/${course.id}/lesson/${id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not make the lesson");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setSourceId(null);
          setPart(0);
        }
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Make a lesson from your material</DialogTitle>
          <DialogDescription>
            Your sources available in the language you learn, originally or through their translation (Translate… on the source page).
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Looking at your sources…
          </p>
        ) : error ? (
          <p className="text-sm text-destructive">{error.message}</p>
        ) : !data?.sources.length ? (
          <p className="text-sm text-muted-foreground">
            None yet. Add a source in this language to a study set, or translate one into it from its source page (Translate…), then come back.
          </p>
        ) : (
          <div className="space-y-3">
            <ul className="scroll-thin max-h-60 space-y-1 overflow-y-auto">
              {data.sources.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSourceId(s.id);
                      setPart(0);
                    }}
                    aria-pressed={sourceId === s.id}
                    className={cn("w-full rounded-md border p-2.5 text-left text-sm", sourceId === s.id ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:bg-muted/50")}
                  >
                    <span className="block font-medium">{s.title}</span>
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      {s.studySetTitle}
                      <Badge variant="outline" className="text-[10px]">
                        {s.via === "original" ? "original" : "translation"}
                      </Badge>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {sourceId &&
              (partsLoading ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Reading the source…
                </p>
              ) : parts && parts.parts > 0 ? (
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm">
                    Part
                    <select className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={part} onChange={(e) => setPart(Number(e.target.value))}>
                      {Array.from({ length: parts.parts }, (_, i) => (
                        <option key={i} value={i}>
                          {i + 1} of {parts.parts}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="rounded-md bg-muted/50 p-2 text-xs italic text-muted-foreground">{parts.preview[part]}…</p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">This source has no text in this language yet.</p>
              ))}
            <div className="flex justify-end">
              <Button onClick={() => void make()} disabled={!sourceId || !parts?.parts || create.isPending} className="gap-1.5">
                {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
                Make the lesson
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
