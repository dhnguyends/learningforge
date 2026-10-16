"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Languages, Loader2, Pause, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { speechUrl, useTranslateSource, type ReaderLanguage, type SourceReader } from "@/hooks/use-api";

const LABELS: Record<ReaderLanguage, string> = { fr: "FR", en: "EN" };
const NAMES: Record<ReaderLanguage, string> = { fr: "French", en: "English" };

/**
 * Read-aloud of a source, one item (segment or passage) after the other, with
 * the TTS model chosen at /admin. Each clip is generated on first request and
 * cached on the server; the next one is requested while the current one plays.
 */
export function useReadAloud(studySetId: string, sourceId: string, reader: SourceReader | undefined, lang: ReaderLanguage) {
  const [index, setIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const runRef = useRef(0);

  const stop = useCallback(() => {
    runRef.current++;
    audioRef.current?.pause();
    audioRef.current = null;
    setIndex(null);
    setLoading(false);
  }, []);

  const hasText = useCallback((i: number) => Boolean(reader?.items[i]?.text[lang]?.trim()), [reader, lang]);

  const start = useCallback(
    (from: number) => {
      if (!reader) return;
      const run = ++runRef.current;
      audioRef.current?.pause();
      const playAt = async (i: number) => {
        while (i < reader.items.length && !hasText(i)) i++;
        if (run !== runRef.current) return;
        if (i >= reader.items.length) {
          stop();
          return;
        }
        setIndex(i);
        setLoading(true);
        const audio = new Audio(speechUrl(studySetId, sourceId, lang, i));
        audioRef.current = audio;
        audio.onended = () => void playAt(i + 1);
        audio.onerror = () => {
          if (run !== runRef.current) return;
          toast.error("Read-aloud failed — check the text-to-speech model at Admin → AI model.");
          stop();
        };
        try {
          await audio.play();
          if (run !== runRef.current) return audio.pause();
          setLoading(false);
          // Warm the next clip while this one plays.
          let next = i + 1;
          while (next < reader.items.length && !hasText(next)) next++;
          if (next < reader.items.length) void fetch(speechUrl(studySetId, sourceId, lang, next)).catch(() => undefined);
        } catch {
          /* onerror reports; an interrupted play() also lands here */
        }
      };
      void playAt(from);
    },
    [reader, studySetId, sourceId, lang, hasText, stop],
  );

  // Changing language or source stops reading.
  useEffect(() => stop, [lang, sourceId, stop]);

  return { index, loading, reading: index !== null, start, stop };
}

/** Language switch, Play / Stop, and the translation status of a source. */
export function ReaderToolbar({
  studySetId,
  sourceId,
  reader,
  lang,
  onLangChange,
  readAloud,
  startIndex = 0,
  canTranslate,
}: {
  studySetId: string;
  sourceId: string;
  reader: SourceReader | undefined;
  lang: ReaderLanguage;
  onLangChange: (lang: ReaderLanguage) => void;
  readAloud: ReturnType<typeof useReadAloud>;
  /** Where Play starts (e.g. the segment at the media's current time). */
  startIndex?: number;
  canTranslate: boolean;
}) {
  const translate = useTranslateSource(studySetId, sourceId);
  if (!reader || reader.items.length === 0) return null;
  const status = reader.translation?.status;
  const translatable = reader.original === "fr";
  const showTranslate = translatable && canTranslate && status !== "running" && !reader.languages.includes("en");

  async function onTranslate() {
    try {
      await translate.mutateAsync();
      toast.success("Translation started — the English text appears here when it is ready.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start the translation");
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="radiogroup" aria-label="Reading language" className="inline-flex rounded-md border border-border p-0.5">
        {(["fr", "en"] as const).map((l) => {
          const available = reader.languages.includes(l);
          return (
            <button
              key={l}
              type="button"
              role="radio"
              aria-checked={lang === l}
              disabled={!available}
              title={available ? NAMES[l] + (l === reader.original ? " (original)" : " (translation)") : `No ${NAMES[l]} text yet`}
              onClick={() => onLangChange(l)}
              className={cn(
                "rounded px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                lang === l ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
              )}
            >
              {LABELS[l]}
            </button>
          );
        })}
      </div>

      <Button
        variant={readAloud.reading ? "secondary" : "outline"}
        size="sm"
        className="gap-1.5"
        onClick={() => (readAloud.reading ? readAloud.stop() : readAloud.start(startIndex))}
        aria-label={readAloud.reading ? "Stop reading aloud" : "Read aloud"}
      >
        {readAloud.loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        ) : readAloud.reading ? (
          <Pause className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        {readAloud.reading ? "Stop" : "Read aloud"}
      </Button>

      {status === "running" && (
        <Badge variant="secondary" className="gap-1">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> Translating to English…
        </Badge>
      )}
      {lang !== reader.original && (
        <Badge variant="outline" className="gap-1" title={reader.translation?.translator ? `Translated by ${reader.translation.translator}` : undefined}>
          <Languages className="h-3 w-3" aria-hidden="true" /> Machine translation
        </Badge>
      )}
      {status === "failed" && (
        <span className="inline-flex items-center gap-1 text-xs text-destructive" title={reader.translation?.error}>
          <AlertTriangle className="h-3 w-3" aria-hidden="true" /> Translation failed
        </span>
      )}
      {showTranslate && (
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={onTranslate} disabled={translate.isPending}>
          {translate.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Languages className="h-3.5 w-3.5" aria-hidden="true" />}
          {status === "failed" ? "Retry translation" : "Translate to English"}
        </Button>
      )}
    </div>
  );
}

/** Document passages in the chosen language; the one being read is highlighted, a click reads from there. */
export function PassageList({
  reader,
  lang,
  activeIndex,
  onReadFrom,
}: {
  reader: SourceReader;
  lang: ReaderLanguage;
  activeIndex: number | null;
  onReadFrom: (index: number) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (activeIndex == null) return;
    listRef.current?.querySelector(`[data-passage="${activeIndex}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeIndex]);

  const items = useMemo(() => reader.items, [reader]);
  if (items.length === 0) return <p className="py-8 text-center text-sm text-muted-foreground">No text yet — it appears when processing finishes.</p>;

  return (
    <div ref={listRef} className="scroll-thin max-h-[70vh] space-y-1 overflow-y-auto pr-1" role="list" aria-label="Source text">
      {items.map((item) => (
        <div
          key={item.id}
          role="listitem"
          data-passage={item.index}
          className={cn("group flex items-start gap-2.5 rounded-lg px-3 py-2 transition-colors", item.index === activeIndex ? "bg-primary/10" : "hover:bg-muted/60")}
        >
          <button
            type="button"
            onClick={() => onReadFrom(item.index)}
            className="mt-0.5 shrink-0 font-mono text-[11px] text-[hsl(var(--citation))] hover:underline"
            aria-label={`Read aloud from ${item.page != null ? `page ${item.page}` : `passage ${item.index + 1}`}`}
            title="Read aloud from here"
          >
            {item.page != null ? `p. ${item.page}` : `§${item.index + 1}`}
          </button>
          <p className="min-w-0 flex-1 whitespace-pre-line text-sm leading-relaxed">{item.text[lang] ?? item.text[reader.original]}</p>
        </div>
      ))}
    </div>
  );
}

/**
 * Reader state for one source: chosen language (original by default), the
 * read-aloud player, and transcript segments shown in that language.
 */
export function useBilingualSource<S extends { id: string; text: string; startMs: number; endMs: number }>(
  studySetId: string,
  sourceId: string,
  reader: SourceReader | undefined,
  segments: S[],
) {
  const [chosen, setChosen] = useState<ReaderLanguage | null>(null);
  useEffect(() => setChosen(null), [sourceId]);
  const lang: ReaderLanguage = chosen && reader?.languages.includes(chosen) ? chosen : (reader?.original ?? "en");
  const readAloud = useReadAloud(studySetId, sourceId, reader, lang);

  const shown = useMemo(() => {
    if (!reader || lang === reader.original) return segments;
    const byId = new Map(reader.items.map((i) => [i.id, i.text[lang]]));
    return segments.map((s) => ({ ...s, text: byId.get(s.id) ?? s.text }));
  }, [segments, reader, lang]);

  const indexById = useMemo(() => new Map((reader?.items ?? []).map((i) => [i.id, i.index])), [reader]);
  const readingItem = readAloud.index != null ? reader?.items[readAloud.index] : undefined;

  return {
    lang,
    setLang: setChosen,
    readAloud,
    /** Segments in the chosen language (same ids and timestamps). */
    segments: shown,
    isOriginal: !reader || lang === reader.original,
    /** Start time of the segment being read aloud, for highlighting. */
    readingStartMs: readingItem?.startMs ?? null,
    /** Reader index of a segment (for "read from here"). */
    indexOf: (segmentId: string) => indexById.get(segmentId) ?? 0,
    /** Reader index of the segment playing at `ms` in the recording. */
    indexAt: (ms: number) => {
      const seg = segments.find((s) => ms >= s.startMs - 50 && ms < s.endMs);
      return seg ? (indexById.get(seg.id) ?? 0) : 0;
    },
  };
}
