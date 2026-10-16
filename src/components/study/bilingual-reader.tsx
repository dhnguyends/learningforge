"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Languages, Loader2, Pause, Pencil, RotateCw, Trash2, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { speechUrl, useDeleteTranslation, useTranslateSource, useTranslationLanguages, type ReaderLanguage, type SourceReader } from "@/hooks/use-api";
import { DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { PointerMenu, isMenuKey, menuPoint, type MenuPoint } from "@/components/shared/pointer-menu";
import { useConfirm } from "@/components/shared/confirm-dialog";


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

/** Language switch, Read aloud, and translation (French → English for search, any language for reading). */
export function ReaderToolbar({
  studySetId,
  sourceId,
  reader,
  lang,
  onLangChange,
  readAloud,
  startIndex = 0,
  canTranslate,
  onEdit,
  editing = false,
  translationMenu,
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
  /** Opens the text editor on the language shown. */
  onEdit?: () => void;
  /** While the editor is open, the language cannot change. */
  editing?: boolean;
  /** Right-click menu of the translations (useTranslationMenu). */
  translationMenu?: ReturnType<typeof useTranslationMenu>;
}) {
  const translate = useTranslateSource(studySetId, sourceId);
  const [picking, setPicking] = useState(false);
  if (!reader || reader.items.length === 0) return null;
  const status = reader.translation?.status;
  const reading = Object.values(reader.readingTranslations ?? {});
  const runningReading = reading.filter((t) => t.status === "running");
  const failedReading = reading.filter((t) => t.status === "failed" && !reader.languages.includes(t.to));
  const busy = status === "running" || runningReading.length > 0;
  const showSearchTranslate = reader.original === "fr" && canTranslate && !busy && !reader.languages.includes("en");
  const voice = reader.voices?.[lang] ?? null;
  const translator = lang === reader.original ? null : (reader.readingTranslations?.[lang]?.translator ?? reader.translation?.translator ?? null);

  async function start(to?: string) {
    setPicking(false);
    try {
      const res = await translate.mutateAsync(to);
      toast.success(`Translating to ${languageLabel(res.to)}: the text appears here when it is ready.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start the translation");
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="radiogroup" aria-label="Reading language" className="inline-flex flex-wrap rounded-md border border-border p-0.5">
        {reader.languages.map((l) => (
          <button
            key={l}
            type="button"
            role="radio"
            aria-checked={lang === l}
            disabled={editing && lang !== l}
            title={`${languageLabel(l)} (${l === reader.original ? "original" : `translation${translationMenu ? ": right-click to translate again or delete" : ""}`})`}
            onContextMenu={translationMenu && l !== reader.original ? (e) => translationMenu.open(e, l) : undefined}
            onKeyDown={translationMenu && l !== reader.original ? (e) => translationMenu.open(e, l) : undefined}
            onClick={() => onLangChange(l)}
            className={cn(
              "rounded px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
              lang === l ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
            )}
          >
            {l.toUpperCase()}
          </button>
        ))}
      </div>

      {onEdit && !editing && (
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5"
          onClick={() => {
            readAloud.stop();
            onEdit();
          }}
          disabled={busy}
          title={`Correct the ${languageLabel(lang)} text${lang === reader.original ? "" : " (translation)"}: find and replace, case, clean-up, spelling…`}
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Edit
        </Button>
      )}

      {canTranslate && (
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setPicking(true)} disabled={busy || translate.isPending}>
          {translate.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Languages className="h-3.5 w-3.5" aria-hidden="true" />}
          Translate…
        </Button>
      )}

      <span title={voice ? `Voice: ${voice}` : `No voice reads ${languageLabel(lang)} with the available text-to-speech models`}>
        <Button
          variant={readAloud.reading ? "secondary" : "outline"}
          size="sm"
          className="gap-1.5"
          onClick={() => (readAloud.reading ? readAloud.stop() : readAloud.start(startIndex))}
          disabled={!voice && !readAloud.reading}
          aria-label={readAloud.reading ? "Stop reading aloud" : `Read aloud in ${languageLabel(lang)}`}
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
      </span>

      {status === "running" && reader.translation && <TranslationProgress status={reader.translation} label="English (for search)" />}
      {runningReading.map((t) => (
        <TranslationProgress key={t.to} status={t} label={languageLabel(t.to)} />
      ))}
      {lang !== reader.original && (
        <Badge variant="outline" className="gap-1" title={translator ? `Translated by ${translator}` : undefined}>
          <Languages className="h-3 w-3" aria-hidden="true" /> Machine translation
        </Badge>
      )}
      {status === "failed" && (
        <span className="inline-flex items-center gap-1 text-xs text-destructive" title={reader.translation?.error}>
          <AlertTriangle className="h-3 w-3" aria-hidden="true" /> English translation failed
        </span>
      )}
      {failedReading.map((t) => (
        <span key={t.to} className="inline-flex items-center gap-1 text-xs text-destructive" title={t.error}>
          <AlertTriangle className="h-3 w-3" aria-hidden="true" /> {languageLabel(t.to)} translation failed
        </span>
      ))}
      {showSearchTranslate && (
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => void start()} disabled={translate.isPending}>
          <Languages className="h-3.5 w-3.5" aria-hidden="true" />
          {status === "failed" ? "Retry English translation" : "Translate to English"}
        </Button>
      )}

      <TranslateDialog
        open={picking}
        onOpenChange={setPicking}
        exclude={reader.languages}
        original={reader.original}
        onPick={(code) => void start(code)}
      />
    </div>
  );
}

type RunningStatus = NonNullable<SourceReader["translation"]>;

/**
 * Progress of a running translation: percentage, items done, and the time
 * left estimated from the speed so far (re-computed every second between the
 * server updates, so the countdown keeps moving).
 */
export function TranslationProgress({ status, label }: { status: RunningStatus; label: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const total = status.total ?? 0;
  const done = Math.min(status.done ?? 0, total);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const started = status.startedAt ? Date.parse(status.startedAt) : NaN;
  const elapsed = Number.isFinite(started) ? Math.max(0, now - started) : 0;
  const remainingMs = done > 0 && total > done ? (elapsed / done) * (total - done) : null;
  const eta =
    total === 0 ? "starting…" : done === 0 ? "estimating time left…" : done >= total ? "finishing…" : `about ${formatDuration(remainingMs ?? 0)} left`;

  return (
    <div className="flex min-w-[14rem] flex-1 flex-col gap-1 sm:max-w-xs" role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="flex items-center gap-1 font-medium">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> Translating to {label}
        </span>
        <span className="tabular-nums text-muted-foreground">{pct}%</span>
      </div>
      <Progress value={pct} aria-label={`Translation to ${label}: ${pct}%`} />
      <span className="text-[11px] tabular-nums text-muted-foreground">
        {total > 0 ? `${done} of ${total} · ` : ""}
        {eta}
      </span>
    </div>
  );
}

function formatDuration(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return m < 60 ? `${m} min${rest ? ` ${rest} s` : ""}` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** Pick a target language among those the active translator offers. */
function TranslateDialog({
  open,
  onOpenChange,
  exclude,
  original,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  exclude: string[];
  original: string;
  onPick: (code: string) => void;
}) {
  const { data, isLoading, error } = useTranslationLanguages(open);
  const [filter, setFilter] = useState("");
  const options = useMemo(() => {
    const q = fold(filter.trim());
    const taken = new Set(exclude.map((l) => l.toLowerCase()));
    return (data?.languages ?? []).filter(
      (l) => !taken.has(l.code.toLowerCase()) && (!q || fold(l.name).includes(q) || l.code.toLowerCase().startsWith(q)),
    );
  }, [data, filter, exclude]);
  const translatorName =
    data?.translator === "azure" ? "Azure AI Translator" : data?.translator === "local" ? "Gemma 4 (local)" : data?.translator;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setFilter("");
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Translate this source</DialogTitle>
          <DialogDescription>
            From {languageLabel(original)} into the language you choose, to read and listen to. The translation is not added to
            search.{translatorName ? ` Translator: ${translatorName}.` : ""}
          </DialogDescription>
        </DialogHeader>
        <Input autoFocus value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search a language" aria-label="Search a language" />
        <div className="scroll-thin max-h-72 overflow-y-auto rounded-md border border-border" role="listbox" aria-label="Languages">
          {isLoading ? (
            <p className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading languages…
            </p>
          ) : error ? (
            <p className="p-3 text-sm text-destructive">{error.message}</p>
          ) : options.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">No language matches.</p>
          ) : (
            options.map((l) => (
              <button
                key={l.code}
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => onPick(l.code)}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
              >
                <span>{l.name}</span>
                <span className="font-mono text-xs text-muted-foreground">{l.code}</span>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/** English name of a language code, in the browser ("es" → "Spanish"). */
export function languageLabel(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
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

/**
 * Right-click menu of a translation (on its language pill, or on the text
 * while it is shown): edit it, translate it again, or delete it — after a
 * deletion, the page offers to translate into the same language again.
 */
export function useTranslationMenu({
  studySetId,
  sourceId,
  reader,
  lang,
  onLangChange,
  onEdit,
}: {
  studySetId: string;
  sourceId: string;
  reader: SourceReader | undefined;
  lang: ReaderLanguage;
  onLangChange: (lang: ReaderLanguage) => void;
  onEdit?: () => void;
}) {
  const [at, setAt] = useState<(MenuPoint & { lang: string }) | null>(null);
  const remove = useDeleteTranslation(studySetId, sourceId);
  const translate = useTranslateSource(studySetId, sourceId);
  const confirm = useConfirm();
  const busy =
    reader?.translation?.status === "running" || Object.values(reader?.readingTranslations ?? {}).some((t) => t.status === "running");
  const what = reader?.kind === "segments" ? "transcript" : "text";
  const isSearch = (l: string) => reader?.translation?.to === l && reader.original === "fr";

  const open = (e: React.MouseEvent | React.KeyboardEvent, l: string = lang) => {
    if (!reader || l === reader.original) return;
    if ("key" in e && !isMenuKey(e)) return;
    e.preventDefault();
    setAt({ ...menuPoint(e as React.MouseEvent), lang: l });
  };

  async function translateAgain(l: string) {
    try {
      // The English translation of a French source is the one search uses.
      const res = await translate.mutateAsync(isSearch(l) ? undefined : l);
      toast.success(`Translating to ${languageLabel(res.to)} again: it appears here when it is ready.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start the translation");
    }
  }

  async function deleteIt(l: string, thenTranslate: boolean) {
    if (!reader) return;
    const name = languageLabel(l);
    const corrected = reader.items.filter((i) => i.edited?.includes(l)).length;
    const lost = [
      corrected > 0 ? `your corrections to ${corrected} passage${corrected > 1 ? "s" : ""}` : null,
      isSearch(l) ? `English questions no longer find this source until it is translated again` : null,
    ].filter(Boolean);
    const ok = await confirm({
      title: thenTranslate ? `Translate the ${what} into ${name} again?` : `Delete the ${name} translation?`,
      description:
        (thenTranslate
          ? `The ${name} ${what} is deleted and translated again with the active translator.`
          : `The ${name} ${what} is deleted; the original stays.`) + (lost.length ? ` You lose ${lost.join("; ")}.` : ""),
      confirmLabel: thenTranslate ? "Translate again" : "Delete",
      destructive: !thenTranslate,
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(l);
      onLangChange(reader.original);
    } catch (e) {
      return toast.error(e instanceof Error ? e.message : "Could not delete the translation");
    }
    if (thenTranslate) return translateAgain(l);
    toast.success(`${name} translation deleted.`);
    const again = await confirm({
      title: `Translate into ${name} again?`,
      description: `Translate the ${what} into ${name} again now, with the active translator? You can also do it later from Translate….`,
      confirmLabel: "Translate again",
      cancelLabel: "Not now",
    });
    if (again) await translateAgain(l);
  }

  const menu = (
    <PointerMenu at={at} onClose={() => setAt(null)}>
      {at && (
        <>
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            {languageLabel(at.lang)} translation{isSearch(at.lang) ? " (used by search)" : ""}
          </DropdownMenuLabel>
          {onEdit && (
            <DropdownMenuItem
              className="gap-2"
              disabled={busy}
              onSelect={() => {
                onLangChange(at.lang);
                onEdit();
              }}
            >
              <Pencil className="h-4 w-4" aria-hidden="true" /> Edit the {languageLabel(at.lang)} {what}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem className="gap-2" disabled={busy} onSelect={() => void deleteIt(at.lang, true)}>
            <RotateCw className="h-4 w-4" aria-hidden="true" /> Translate again into {languageLabel(at.lang)}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="gap-2 text-destructive focus:text-destructive" disabled={busy} onSelect={() => void deleteIt(at.lang, false)}>
            <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete the {languageLabel(at.lang)} translation…
          </DropdownMenuItem>
          {busy && <p className="px-2 py-1 text-xs text-muted-foreground">A translation is running: wait for it to finish.</p>}
        </>
      )}
    </PointerMenu>
  );

  return { open, menu };
}
