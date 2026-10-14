"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Flag, Info } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/misc";
import { Label } from "@/components/ui/label";
import { MediaPlayer, SegmentList, TranscriptSearch, useMediaSync } from "@/components/study/source-viewer";
import { useSource, useStudySet } from "@/hooks/use-api";

export default function TranscriptPage() {
  return (
    <Suspense fallback={null}>
      <TranscriptPageInner />
    </Suspense>
  );
}

function TranscriptPageInner() {
  const { studySetId } = useParams<{ studySetId: string }>();
  const params = useSearchParams();
  const initialSource = params.get("source");
  const seekSec = Number(params.get("t") ?? 0) || 0;

  const { data: set } = useStudySet(studySetId);
  const avSources = useMemo(() => (set?.sources ?? []).filter((s) => s.type === "VIDEO" || s.type === "AUDIO" || s.type === "YOUTUBE"), [set]);

  const [sourceId, setSourceId] = useState<string | null>(initialSource);
  useEffect(() => {
    if (!sourceId && avSources.length > 0) setSourceId(avSources[0].id);
  }, [sourceId, avSources]);

  const { data } = useSource(studySetId, sourceId ?? "");
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const { timeMs, playing, seek } = useMediaSync(mediaRef);

  const [query, setQuery] = useState("");
  const [flaggedOnly, setFlaggedOnly] = useState(false);

  const allSegments = useMemo(() => data?.source?.transcripts?.[0]?.segments ?? [], [data]);
  const segments = useMemo(() => (flaggedOnly ? allSegments.filter((s) => s.flagged) : allSegments), [allSegments, flaggedOnly]);
  const editedCount = allSegments.filter((s) => s.edited).length;
  const flaggedCount = allSegments.filter((s) => s.flagged).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Transcript</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Searchable, speaker-aware, and editable — corrections propagate to future generations.
          </p>
        </div>
        {avSources.length > 1 && (
          <div className="space-y-1.5">
            <Label htmlFor="src-select" className="text-xs text-muted-foreground">Source</Label>
            <select
              id="src-select"
              value={sourceId ?? ""}
              onChange={(e) => setSourceId(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {avSources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {!sourceId ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            This study set has no lecture recordings yet — transcripts come from audio, video or YouTube sources. Documents
            (PDFs, slides, notes) are read directly and appear under Sources.
          </CardContent>
        </Card>
      ) : (
        <>
          {data && (
            <div className="sticky top-[calc(3.5rem+2.75rem)] z-20 -mx-4 border-b border-border/60 bg-background/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-lg sm:border sm:px-4 lg:top-14">
              <MediaPlayer detail={data} startAtSec={seekSec} mediaRef={mediaRef} />
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <TranscriptSearch value={query} onChange={setQuery} />
                </div>
                <div className="flex items-center gap-2">
                  <Switch id="flagged" checked={flaggedOnly} onCheckedChange={setFlaggedOnly} aria-label="Show flagged segments only" />
                  <Label htmlFor="flagged" className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Flag className="h-3 w-3" aria-hidden="true" /> Flagged ({flaggedCount})
                  </Label>
                </div>
              </div>
            </div>
          )}

          {allSegments.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="secondary">{allSegments.length} segments</Badge>
              {editedCount > 0 && <Badge variant="outline">{editedCount} edited</Badge>}
              {flaggedCount > 0 && <Badge variant="warning">{flaggedCount} flagged</Badge>}
              <span className="inline-flex items-center gap-1">
                <Info className="h-3 w-3" aria-hidden="true" />
                Click a timestamp to jump the player; edit icon fixes transcription errors.
              </span>
            </div>
          )}

          <Card>
            <CardContent className="py-2">
              <SegmentList
                segments={segments}
                currentTimeMs={timeMs}
                onSeekMs={seek}
                playing={playing && !query}
                editable
                filter={query}
              />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
