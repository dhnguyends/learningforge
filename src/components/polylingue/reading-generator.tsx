"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { READING_FORMATS, READING_TOPICS } from "@/lib/polylingue/practice";
import { useCreateReading } from "@/hooks/use-polylingue";

/**
 * Generate a personal reading: choose a kind of source and a subject; the AI
 * model writes a text in that style at the course level, with a glossary and
 * questions.
 */
export function ReadingGenerator({ courseId, level }: { courseId: string; level?: string }) {
  const router = useRouter();
  const create = useCreateReading(courseId);
  const [format, setFormat] = useState<string>("newspaper");
  const [topic, setTopic] = useState<string>("history");
  const [custom, setCustom] = useState("");

  async function generate() {
    try {
      const { id } = await create.mutateAsync({ format, topic, customTopic: topic === "custom" ? custom : undefined });
      router.push(`/polylingue/${courseId}/practice/reading/${id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not generate");
    }
  }

  const chip = (selected: boolean) =>
    cn("rounded-full border px-3 py-1.5 text-sm transition-colors", selected ? "border-primary bg-primary/10 font-medium text-primary" : "border-border hover:bg-muted/50");

  return (
    <Card className="border-primary/30">
      <CardContent className="space-y-4 p-5">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" /> Generate a reading
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose a kind of source and a subject: the text is written in that style{level ? ` at your ${level} level` : ""}, with a glossary and questions.
          </p>
        </div>
        <fieldset className="space-y-2">
          <legend className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Source</legend>
          <div className="flex flex-wrap gap-2">
            {READING_FORMATS.map((f) => (
              <button key={f.id} type="button" aria-pressed={format === f.id} onClick={() => setFormat(f.id)} className={chip(format === f.id)}>
                {f.label}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Content</legend>
          <div className="flex flex-wrap gap-2">
            {READING_TOPICS.map((t) => (
              <button key={t.id} type="button" aria-pressed={topic === t.id} onClick={() => setTopic(t.id)} className={chip(topic === t.id)}>
                {t.label}
              </button>
            ))}
          </div>
          {topic === "custom" && (
            <Input
              autoFocus
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              maxLength={80}
              placeholder="e.g. the history of chocolate, a trip to Mars, climate change"
              aria-label="Your topic"
            />
          )}
        </fieldset>
        <div className="flex justify-end">
          <Button onClick={() => void generate()} disabled={create.isPending || (topic === "custom" && !custom.trim())} className="gap-1.5">
            {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
            Generate
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
