"use client";

import { Suspense, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { ChevronLeft, ExternalLink, Loader2, Plus, RotateCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MediaPlayer, SegmentList, useMediaSync } from "@/components/study/source-viewer";
import { PipelineStatusBar } from "@/components/shared/pipeline-status";
import { useSource, useStudySet, useDeleteSource, useReprocessSource } from "@/hooks/use-api";
import { SourceRowActions, IMPORTING_STATUSES, deleteSourcePrompt, reprocessSourcePrompt } from "@/components/study/source-actions";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { ingestJobFor } from "@/lib/pipeline-phases";
import { cn, formatDuration } from "@/lib/utils";

export default function SourcesPage() {
  return (
    <Suspense fallback={null}>
      <SourcesPageInner />
    </Suspense>
  );
}

function SourcesPageInner() {
  const { studySetId } = useParams<{ studySetId: string }>();
  const params = useSearchParams();
  const selected = params.get("source");
  const seekSec = Number(params.get("t") ?? 0) || 0;
  const pageParam = Number(params.get("page") ?? 0) || 0;

  const { data: set, isLoading } = useStudySet(studySetId);
  const deleteSource = useDeleteSource(studySetId);
  const reprocessSource = useReprocessSource(studySetId);
  const confirm = useConfirm();

  if (selected) {
    return (
      <SourceDetailPage
        studySetId={studySetId}
        sourceId={selected}
        seekSec={seekSec}
        page={pageParam}
        onBack={() => window.history.pushState(null, "", `/study-sets/${studySetId}/sources`)}
        onDelete={async (id, title) => {
          if (!(await confirm(deleteSourcePrompt(title)))) return;
          try {
            await deleteSource.mutateAsync(id);
            toast.success("Source deleted");
            window.history.pushState(null, "", `/study-sets/${studySetId}/sources`);
            window.location.reload();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Delete failed");
          }
        }}
        onReprocess={async (id, title) => {
          if (!(await confirm(reprocessSourcePrompt(title)))) return;
          try {
            await reprocessSource.mutateAsync(id);
            toast.success(`Importing "${title}" again`);
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Could not start the import");
          }
        }}
        reprocessing={reprocessSource.isPending}
      />
    );
  }

  const sources = set?.sources ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Sources</h1>
          <p className="mt-1 text-sm text-muted-foreground">Everything feeding this study set — click a source to open it at its citations.</p>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link href={`/create?studySetId=${studySetId}`}>
            <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Add source
          </Link>
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Card><CardContent className="py-6" /></Card>
          <Card><CardContent className="py-6" /></Card>
        </div>
      ) : sources.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="font-medium">No sources yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Add a lecture recording, paper, slides, or a YouTube link.</p>
            <Button asChild className="mt-4" size="sm">
              <Link href={`/create?studySetId=${studySetId}`}>Add your first source</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {sources.map((s) => {
            const processing = s.status !== "READY";
            return (
              <li key={s.id} className="flex items-start gap-2">
                <Link
                  href={`/study-sets/${studySetId}/sources?source=${s.id}`}
                  className={cn(
                    "flex min-w-0 flex-1 gap-3 rounded-lg border border-border px-4 py-3 transition-colors hover:border-primary/40",
                    processing && "flex-col",
                  )}
                >
                  <div className="flex w-full items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{s.title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {s.type}
                        {s.durationSec ? ` · ${formatDuration(s.durationSec)}` : ""}
                        {s.language ? ` · ${s.language}` : ""}
                      </p>
                    </div>
                    {s.externalUrl && <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
                    <Badge variant={s.status === "READY" ? "success" : s.status === "FAILED" ? "destructive" : "secondary"}>{s.status}</Badge>
                  </div>
                  {processing && <PipelineStatusBar status={s.status} job={ingestJobFor(set?.jobs, s.id)} />}
                </Link>
                <div className="pt-2">
                  <SourceRowActions studySetId={studySetId} source={s} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function SourceDetailPage({
  studySetId,
  sourceId,
  seekSec,
  page,
  onBack,
  onDelete,
  onReprocess,
  reprocessing,
}: {
  studySetId: string;
  sourceId: string;
  seekSec: number;
  page: number;
  onBack: () => void;
  onDelete: (id: string, title: string) => void;
  onReprocess: (id: string, title: string) => void;
  reprocessing: boolean;
}) {
  const { data, isLoading } = useSource(studySetId, sourceId);
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const { timeMs, playing, seek } = useMediaSync(mediaRef);
  const [showFullTranscript, setShowFullTranscript] = useState(false);

  const segments = useMemo(() => data?.source.transcripts[0]?.segments ?? [], [data]);

  if (isLoading || !data) {
    return <div className="h-64 animate-pulse rounded-lg bg-muted" />;
  }

  const s = data.source;
  const isAv = s.playbackKind === "video" || s.playbackKind === "audio" || s.playbackKind === "youtube";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5">
          <ChevronLeft className="h-4 w-4" aria-hidden="true" /> All sources
        </Button>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={() => onReprocess(s.id, s.title)}
            disabled={reprocessing || IMPORTING_STATUSES.includes(s.status)}
            title={IMPORTING_STATUSES.includes(s.status) ? "Already importing" : undefined}
          >
            {reprocessing ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />}
            Import again
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-destructive hover:text-destructive"
            onClick={() => onDelete(s.id, s.title)}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Delete permanently
          </Button>
        </div>
      </div>

      <div>
        <h1 className="text-xl font-semibold tracking-tight">{s.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {s.type} · {s.status}
          {s.durationSec ? ` · ${formatDuration(s.durationSec)}` : ""}
          {s.error ? ` · ${s.error}` : ""}
        </p>
      </div>

      <MediaPlayer
        detail={data}
        startAtSec={s.playbackKind === "document" ? page : seekSec}
        mediaRef={mediaRef}
      />

      {isAv && segments.length > 0 && (
        <Card>
          <CardContent className="py-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-medium">Transcript</h2>
              <Button variant="ghost" size="sm" onClick={() => setShowFullTranscript((v) => !v)}>
                {showFullTranscript ? "Collapse" : "Expand"}
              </Button>
            </div>
            {showFullTranscript ? (
              <SegmentList segments={segments} currentTimeMs={timeMs} onSeekMs={seek} playing={playing} />
            ) : (
              <p className="line-clamp-3 text-sm leading-relaxed text-muted-foreground">
                {segments.slice(0, 6).map((seg) => seg.text).join(" ")}…{" "}
                <Link href={`/study-sets/${studySetId}/transcript?source=${s.id}`} className="text-primary hover:underline">
                  Open full transcript editor
                </Link>
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
