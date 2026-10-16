"use client";

import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import { BookOpen, CheckCircle2, Circle, Headphones, Loader2, Mic, PenLine } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { usePolyCourse, usePractices, type PracticeListItem, type SkillSlug } from "@/hooks/use-polylingue";
import { ReadingGenerator } from "@/components/polylingue/reading-generator";

const SKILLS: Record<SkillSlug, { title: string; icon: typeof BookOpen; intro: string }> = {
  reading: { title: "Reading", icon: BookOpen, intro: "Read a short text on the unit's theme, tap words to see their meaning, and answer questions." },
  listening: { title: "Listening", icon: Headphones, intro: "Write what you hear (dictation), then listen to a dialogue or a monologue and answer questions." },
  writing: { title: "Writing", icon: PenLine, intro: "Write a short text; the AI teacher corrects it, explains each mistake and shows a model answer." },
  speaking: { title: "Speaking", icon: Mic, intro: "Repeat sentences after the model and answer questions aloud; your speech is checked word by word." },
};

/** One skill: a practice per unit of the course, on the unit's theme. */
export default function SkillPage() {
  const { courseId, skill } = useParams<{ courseId: string; skill: string }>();
  if (!(skill in SKILLS)) notFound();
  const meta = SKILLS[skill as SkillSlug];
  const { data: course } = usePolyCourse(courseId);
  const { data, isLoading, error } = usePractices(courseId, skill as SkillSlug);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6 sm:px-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <meta.icon className="h-5 w-5 text-primary" aria-hidden="true" /> {meta.title}
          {course && <span className="font-mono text-sm text-muted-foreground">{course.level}</span>}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{meta.intro}</p>
      </div>

      {error ? (
        <p className="text-sm text-destructive">{error.message}</p>
      ) : isLoading ? (
        <div className="h-48 animate-pulse rounded-lg bg-muted" />
      ) : !data?.ready ? (
        <Card>
          <CardContent className="flex items-center gap-3 p-5 text-sm">
            <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden="true" /> Your course is being written; practice opens when it is ready.
          </CardContent>
        </Card>
      ) : (
        <>
          {skill === "reading" && <ReadingGenerator courseId={courseId} level={course?.level} />}
          {data.personal.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-sm font-semibold">Your readings</h2>
              <PracticeList items={data.personal} courseId={courseId} skill={skill} personal />
            </div>
          )}
          {skill === "reading" && <h2 className="pt-1 text-sm font-semibold">Course readings, one per unit</h2>}
          <PracticeList items={data.practices} courseId={courseId} skill={skill} />
        </>
      )}
    </div>
  );
}

function PracticeList({ items, courseId, skill, personal = false }: { items: PracticeListItem[]; courseId: string; skill: string; personal?: boolean }) {
  return (
        <Card>
          <CardContent className="p-2">
            <ul className="divide-y divide-border/60">
              {items.map((p) => (
                <li key={p.id}>
                  <Link href={`/polylingue/${courseId}/practice/${skill}/${p.id}`} className="flex items-center gap-3 rounded-md px-3 py-3 text-sm hover:bg-muted/50">
                    {p.completed ? (
                      <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" aria-label="Done" />
                    ) : (
                      <Circle className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{personal ? p.title : `Unit ${p.unitIndex + 1} · ${p.unitTitle}`}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {personal ? (p.failed ? "Could not be written: open it to try again" : p.ready ? p.theme : "Being written…") : p.ready && p.title !== p.unitTitle ? p.title : p.theme}
                      </span>
                    </span>
                    {personal && !p.ready && !p.failed && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />}
                    {p.completed && <span className="text-xs tabular-nums text-muted-foreground">{p.bestScore}%</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
  );
}
