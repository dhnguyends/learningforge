"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { AlertTriangle, Check, Headphones, Loader2, Pencil, RefreshCw, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Markdown } from "@/components/shared/markdown";
import { ClaimBadge } from "@/components/shared/claim-badge";
import { CitationList, type AnchorData } from "@/components/shared/citation-chip";
import { useGuide, useGenerateGuide, usePatchGuideSection, useRegenerateSection, useGenerateRecap, useIndexingReadiness, type GuideSectionRow } from "@/hooks/use-api";
import { IndexingNotice } from "@/components/study/indexing-notice";

const STYLES: { value: string; label: string }[] = [
  { value: "LECTURE_NOTES", label: "Lecture notes" },
  { value: "EXAM_REVISION", label: "Exam revision" },
  { value: "TECHNICAL_OUTLINE", label: "Technical outline" },
  { value: "CORNELL", label: "Cornell" },
  { value: "PAPER_NOTES", label: "Paper notes" },
];

export default function GuidePage() {
  const { studySetId } = useParams<{ studySetId: string }>();
  const { data, isLoading } = useGuide(studySetId);
  const generate = useGenerateGuide(studySetId);
  const recap = useGenerateRecap(studySetId);
  const readiness = useIndexingReadiness(studySetId);
  const canGenerate = readiness.data?.ready === true;

  const [style, setStyle] = useState("LECTURE_NOTES");
  const guide = data?.guide;
  const generating = guide?.status === "GENERATING";
  const recapMeta = guide?.metadata?.recap as { script?: string; audioKey?: string; audioUrl?: string } | undefined;

  async function onGenerate(regenerate: boolean) {
    try {
      await generate.mutateAsync({ style, regenerate });
      toast.success(regenerate ? "Regenerating guide" : "Generating guide");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start generation");
    }
  }

  async function onRecap() {
    if (!guide) return;
    try {
      await recap.mutateAsync(guide.id);
      toast.success("Audio recap started");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start recap");
    }
  }

  if (isLoading) {
    return <div className="h-96 animate-pulse rounded-lg bg-muted" />;
  }

  if (!guide) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
          <div className="rounded-full bg-primary/10 p-3 text-primary"><Volume2 className="h-6 w-6 rotate-180" aria-hidden="true" /></div>
          <div>
            <p className="font-medium">No study guide yet</p>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              A guide is written section by section from your indexed sources — every paragraph carries citations and a
              provenance label.
            </p>
          </div>
          <IndexingNotice readiness={readiness.data} />
          <div className="flex items-center gap-2">
            <Select value={style} onValueChange={setStyle}>
              <SelectTrigger className="w-44" aria-label="Guide style"><SelectValue /></SelectTrigger>
              <SelectContent>
                {STYLES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={() => void onGenerate(false)} disabled={generate.isPending || !canGenerate}>
              {generate.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              Generate guide
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const sections = guide.sections ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{guide.title}</h1>
            <Badge variant="secondary">{STYLES.find((s) => s.value === guide.style)?.label ?? guide.style}</Badge>
            {generating && (
              <Badge variant="outline" className="gap-1">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> generating…
              </Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {sections.length} sections · {sections.reduce((n, s) => n + s.anchors.length, 0)} citations
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={style} onValueChange={setStyle}>
            <SelectTrigger className="h-9 w-40" aria-label="Guide style"><SelectValue /></SelectTrigger>
            <SelectContent>
              {STYLES.map((s) => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => void onGenerate(true)} disabled={generate.isPending || !canGenerate}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Regenerate all
          </Button>
        </div>
      </div>

      <IndexingNotice readiness={readiness.data} />

      {/* Audio recap */}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary"><Headphones className="h-4 w-4" aria-hidden="true" /></div>
            <div>
              <p className="text-sm font-medium">Audio recap</p>
              <p className="text-xs text-muted-foreground">A listen-only summary of this guide for commute review.</p>
            </div>
          </div>
          {recapMeta?.audioUrl ? (
            <audio controls src={recapMeta.audioUrl} className="min-w-[240px] flex-1 max-w-md" />
          ) : (
            <Button variant="outline" size="sm" onClick={() => void onRecap()} disabled={recap.isPending || generating}>
              {recap.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
              {guide.metadata?.recapScript ? "Regenerate audio" : "Generate audio"}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Sections */}
      {sections.length === 0 && !generating && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No sections yet — regenerate, or add more sources.
          </CardContent>
        </Card>
      )}
      <div className="space-y-4">
        {sections.map((section) => (
          <GuideSection key={section.id} section={section} studySetId={studySetId} />
        ))}
      </div>
    </div>
  );
}

function GuideSection({ section, studySetId }: { section: GuideSectionRow; studySetId: string }) {
  const patch = usePatchGuideSection(studySetId);
  const regen = useRegenerateSection(studySetId);
  const canGenerate = useIndexingReadiness(studySetId).data?.ready === true;
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(section.title);
  const [content, setContent] = useState(section.content);

  const anchors: AnchorData[] = section.anchors.map((a) => ({
    id: a.id,
    sourceId: a.sourceId,
    sourceTitle: a.source?.title ?? "Source",
    sourceType: a.source?.type ?? "",
    startMs: a.startMs,
    endMs: a.endMs,
    page: a.page,
    excerpt: a.excerpt,
  }));

  async function save() {
    try {
      await patch.mutateAsync({ sectionId: section.id, title, content });
      toast.success("Section saved");
      setEditing(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    }
  }

  async function regenerate() {
    try {
      await regen.mutateAsync(section.id);
      toast.success("Rewriting this section");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not regenerate");
    }
  }

  const isSub = section.parentIndex != null;
  const lowConfidence = section.confidence != null && section.confidence < 0.7;

  return (
    <Card id={`section-${section.ordinal}`} className={isSub ? "border-l-4 border-l-primary/30" : undefined}>
      <CardContent className="space-y-3 py-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {editing ? (
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                aria-label="Section title"
                className="w-full rounded-md border border-input bg-transparent px-2 py-1 text-lg font-semibold shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            ) : (
              <h2 className={`${isSub ? "text-base" : "text-lg"} font-semibold tracking-tight`}>{section.title}</h2>
            )}
            <ClaimBadge type={section.claimType as never} compact />
            {section.version > 1 && <Badge variant="muted" className="text-[10px]">v{section.version}</Badge>}
            {lowConfidence && (
              <Badge variant="warning" className="gap-1 text-[10px]">
                <AlertTriangle className="h-3 w-3" aria-hidden="true" /> low confidence
              </Badge>
            )}
          </div>
          <div className="flex shrink-0 gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Edit section" onClick={() => setEditing((v) => !v)}>
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Regenerate this section only" onClick={() => void regenerate()} disabled={regen.isPending || !canGenerate}>
              <RefreshCw className={`h-3.5 w-3.5 ${regen.isPending ? "animate-spin" : ""}`} aria-hidden="true" />
            </Button>
          </div>
        </div>

        {editing ? (
          <div className="space-y-2">
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={Math.min(24, Math.max(6, content.split("\n").length + 2))}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Section content (Markdown + LaTeX)"
            />
            <p className="text-xs text-muted-foreground">Markdown + LaTeX ($…$ / $$…$$). Editing creates a version snapshot.</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => { setEditing(false); setTitle(section.title); setContent(section.content); }}>Cancel</Button>
              <Button size="sm" onClick={() => void save()} disabled={patch.isPending}>
                {patch.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
                Save
              </Button>
            </div>
          </div>
        ) : (
          <>
            <Markdown content={section.content} />
            {section.warnings.length > 0 && (
              <ul className="space-y-1 rounded-lg border border-[hsl(var(--warning))]/40 bg-[hsl(var(--warning))]/5 p-3 text-xs text-muted-foreground">
                {section.warnings.map((w, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-[hsl(var(--warning))]" aria-hidden="true" /> {w}
                  </li>
                ))}
              </ul>
            )}
            {section.learningObjective && (
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground/80">Learning objective:</span> {section.learningObjective}
              </p>
            )}
            {anchors.length > 0 && <CitationList anchors={anchors} studySetId={studySetId} max={6} size="default" />}
          </>
        )}
      </CardContent>
    </Card>
  );
}
