"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Flag, Loader2, Pause, Play, Pencil, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { SourceDetail, TranscriptSegmentRow } from "@/hooks/use-api";
import { usePatchSegment } from "@/hooks/use-api";
import { cn, formatTimestamp } from "@/lib/utils";

/* ------------------------------ media player ------------------------------ */

export function MediaPlayer({
  detail,
  startAtSec = 0,
  mediaRef,
  onTimeMs,
}: {
  detail: SourceDetail;
  startAtSec?: number;
  mediaRef?: React.RefObject<HTMLVideoElement | HTMLAudioElement | null>;
  onTimeMs?: (ms: number) => void;
}) {
  const src = detail.source;
  const key = `${src.id}-${Math.floor(startAtSec)}`;

  // Propagate currentTime upward while playing.
  const internalRef = useRef<HTMLVideoElement | null>(null);
  const ref = mediaRef ?? internalRef;
  useEffect(() => {
    const el = ref.current;
    if (!el || !onTimeMs) return;
    const handler = () => onTimeMs(el.currentTime * 1000);
    el.addEventListener("timeupdate", handler);
    return () => el.removeEventListener("timeupdate", handler);
  }, [ref, onTimeMs]);

  if (src.playbackKind === "youtube") {
    const videoId = (src.metadata as { videoId?: string } | null)?.videoId;
    return (
      <div className="overflow-hidden rounded-lg border border-border bg-black">
        <div className="relative aspect-video">
          <iframe
            key={key}
            src={videoId ? `https://www.youtube.com/embed/${videoId}?start=${Math.max(0, Math.floor(startAtSec))}&rel=0` : undefined}
            title={src.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture"
            allowFullScreen
            className="absolute inset-0 h-full w-full"
          />
        </div>
      </div>
    );
  }

  if (src.playbackKind === "document" || !src.playbackUrl) {
    const originalUrl = Object.values(src.assetUrls)[0];
    if (src.type === "PDF" && originalUrl) {
      return (
        <div className="overflow-hidden rounded-lg border border-border bg-muted/40">
          <iframe key={key} src={`${originalUrl}#page=${startAtSec || 1}`} title={src.title} className="h-[70vh] w-full" />
        </div>
      );
    }
    return (
      <div className="flex items-center justify-center rounded-lg border border-dashed border-border p-10 text-sm text-muted-foreground">
        {src.status === "PROCESSING" ? "Still processing — preview appears when ready." : "No inline preview for this source type."}
      </div>
    );
  }

  return src.playbackKind === "video" ? (
    <video key={key} ref={ref as React.RefObject<HTMLVideoElement>} controls preload="metadata" src={src.playbackUrl} className="max-h-[60vh] w-full rounded-lg border border-border bg-black" />
  ) : (
    <audio key={key} ref={ref as React.RefObject<HTMLAudioElement>} controls preload="metadata" src={src.playbackUrl} className="w-full rounded-lg" />
  );
}

/* ----------------------------- segment listing ---------------------------- */

function findActiveSegment(segments: TranscriptSegmentRow[], ms: number): TranscriptSegmentRow | null {
  for (const s of segments) {
    if (ms >= s.startMs - 50 && ms < s.endMs) return s;
  }
  return null;
}

export function SegmentList({
  segments,
  currentTimeMs,
  onSeekMs,
  playing = false,
  editable = false,
  filter,
}: {
  segments: TranscriptSegmentRow[];
  currentTimeMs?: number;
  onSeekMs?: (ms: number) => void;
  playing?: boolean;
  editable?: boolean;
  filter?: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const patchSegment = usePatchSegment();

  const visible = useMemo(() => {
    if (!filter?.trim()) return segments;
    const q = filter.trim().toLowerCase();
    return segments.filter((s) => s.text.toLowerCase().includes(q) || (s.speaker ?? "").toLowerCase().includes(q));
  }, [segments, filter]);

  const activeId = currentTimeMs != null ? findActiveSegment(segments, currentTimeMs)?.id ?? null : null;

  // Follow the active segment while playing (unless the user is editing).
  useEffect(() => {
    if (!playing || !activeId || editingId) return;
    const container = listRef.current;
    const el = container?.querySelector(`[data-segment-id="${activeId}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeId, playing, editingId]);

  if (segments.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No transcript yet — it appears when processing finishes.</p>;
  }

  return (
    <div ref={listRef} className="scroll-thin max-h-[70vh] space-y-1 overflow-y-auto pr-1" role="list" aria-label="Transcript segments">
      {visible.map((seg) => {
        const isActive = seg.id === activeId;
        const isEditing = seg.id === editingId;
        return (
          <div
            key={seg.id}
            data-segment-id={seg.id}
            role="listitem"
            className={cn(
              "group rounded-lg px-3 py-2 transition-colors",
              isActive && "bg-primary/10",
              !isActive && "hover:bg-muted/60",
              seg.flagged && "ring-1 ring-inset ring-[hsl(var(--warning))]/40",
              filter && !isActive && "bg-transparent",
            )}
          >
            {isEditing ? (
              <SegmentEditor
                segment={seg}
                saving={patchSegment.isPending && patchSegment.variables?.segmentId === seg.id}
                onSave={async (text, note) => {
                  try {
                    await patchSegment.mutateAsync({ segmentId: seg.id, text, note });
                    toast.success("Segment saved");
                    setEditingId(null);
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Save failed");
                  }
                }}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <div className="flex items-start gap-2.5">
                <button
                  type="button"
                  onClick={() => onSeekMs?.(seg.startMs)}
                  className="mt-0.5 shrink-0 font-mono text-[11px] text-[hsl(var(--citation))] hover:underline"
                  aria-label={`Jump to ${formatTimestamp(seg.startMs)}`}
                >
                  {formatTimestamp(seg.startMs)}
                </button>
                <p className="min-w-0 flex-1 text-sm leading-relaxed">
                  {seg.speaker && <span className="mr-1.5 font-medium text-foreground/80">{seg.speaker}:</span>}
                  {filter?.trim() ? <Highlighted text={seg.text} query={filter.trim()} /> : seg.text}
                  {seg.note && (
                    <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground" title="Your note">
                      {seg.note}
                    </span>
                  )}
                </p>
                {editable && (
                  <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      aria-label={seg.flagged ? "Unflag segment" : "Flag segment for review"}
                      title={seg.flagged ? "Unflag" : "Flag"}
                      onClick={() =>
                        void patchSegment
                          .mutateAsync({ segmentId: seg.id, flagged: !seg.flagged })
                          .catch((err) => toast.error(err instanceof Error ? err.message : "Failed"))
                      }
                    >
                      <Flag className={cn("h-3 w-3", seg.flagged ? "fill-[hsl(var(--warning))] text-[hsl(var(--warning))]" : "text-muted-foreground")} aria-hidden="true" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-6 w-6" aria-label="Edit segment" onClick={() => setEditingId(seg.id)}>
                      <Pencil className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
                    </Button>
                  </span>
                )}
              </div>
            )}
            {seg.edited && !isEditing && (
              <Badge variant="muted" className="ml-14 mt-1 text-[10px]">
                edited
              </Badge>
            )}
          </div>
        );
      })}
      {visible.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">No segments match “{filter}”.</p>
      )}
    </div>
  );
}

function Highlighted({ text, query }: { text: string; query: string }) {
  const i = text.toLowerCase().indexOf(query.toLowerCase());
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded bg-[hsl(var(--citation))]/30 px-0.5">{text.slice(i, i + query.length)}</mark>
      {text.slice(i + query.length)}
    </>
  );
}

function SegmentEditor({
  segment,
  saving,
  onSave,
  onCancel,
}: {
  segment: TranscriptSegmentRow;
  saving: boolean;
  onSave: (text: string, note: string | null) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(segment.text);
  const [note, setNote] = useState(segment.note ?? "");
  return (
    <div className="space-y-2 rounded-lg border border-primary/40 bg-background p-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="font-mono text-[hsl(var(--citation))]">
          {formatTimestamp(segment.startMs)}–{formatTimestamp(segment.endMs)}
        </span>
        <span>Editing — changes are versioned on the source</span>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Segment text"
      />
      <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note (e.g. 'equation should be σ = 1/(1+e^-x)')" aria-label="Segment note" className="text-xs" />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          <X className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Cancel
        </Button>
        <Button size="sm" onClick={() => onSave(text, note || null)} disabled={saving}>
          {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
          Save
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------ search control ---------------------------- */

export function TranscriptSearch({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder ?? "Search the transcript…"} className="pl-9 pr-8" />
      {value && (
        <button type="button" onClick={() => onChange("")} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground">
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/* --------------------------- playback hook (local) ------------------------- */

/** Tracks media element time + play state; returns controls. */
export function useMediaSync(mediaRef: React.RefObject<HTMLVideoElement | HTMLAudioElement | null>) {
  const [timeMs, setTimeMs] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const el = mediaRef.current;
    if (!el) return;
    const onTime = () => setTimeMs(el.currentTime * 1000);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
    };
  }, [mediaRef]);

  const seek = useCallback(
    (ms: number) => {
      const el = mediaRef.current;
      if (!el) return;
      el.currentTime = Math.max(0, ms / 1000);
      setTimeMs(ms);
      void el.play().catch(() => undefined);
    },
    [mediaRef],
  );

  const toggle = useCallback(() => {
    const el = mediaRef.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => undefined);
    else el.pause();
  }, [mediaRef]);

  return { timeMs, playing, seek, toggle };
}

/** Small play/pause button bound to a media element. */
export function PlayPauseButton({ playing, onClick }: { playing: boolean; onClick: () => void }) {
  return (
    <Button variant="outline" size="icon" onClick={onClick} aria-label={playing ? "Pause" : "Play"}>
      {playing ? <Pause className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
    </Button>
  );
}
