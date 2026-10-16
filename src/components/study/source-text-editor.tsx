"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CaseSensitive,
  ChevronDown,
  ChevronUp,
  Loader2,
  Omega,
  Redo2,
  RotateCcw,
  Save,
  Search,
  SpellCheck,
  Undo2,
  Wand2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { cn, formatTimestamp } from "@/lib/utils";
import {
  SPECIAL_CHARACTERS,
  changeCase,
  cleanUpText,
  countWords,
  findMatches,
  joinBrokenLines,
  joinBrokenWords,
  replaceAll,
  tidySpaces,
  type CaseStyle,
  type FindOptions,
} from "@/lib/text-tools";
import { useSaveSourceText, type SourceReader } from "@/hooks/use-api";
import { languageLabel } from "@/components/study/bilingual-reader";

type Drafts = Record<string, string>;
interface Caret {
  id: string;
  start: number;
  end: number;
}

/**
 * Word-processing editor for a source's text in one language: the transcript
 * of a recording or the passages of a document (OCR text), original or
 * translation. Plain text only, because the text is searched, cited and read
 * aloud: undo / redo, find and replace, change case, clean up OCR and
 * transcription artefacts, special characters, spell check in the text's
 * language, word count. Nothing is stored until Save.
 */
export function SourceTextEditor({
  studySetId,
  sourceId,
  reader,
  lang,
  onClose,
}: {
  studySetId: string;
  sourceId: string;
  reader: SourceReader;
  lang: string;
  onClose: () => void;
}) {
  const save = useSaveSourceText(studySetId, sourceId);
  const confirm = useConfirm();
  const isOriginal = lang === reader.original;
  const [initial] = useState<Drafts>(() => Object.fromEntries(reader.items.map((i) => [i.id, i.text[lang] ?? ""])));
  const [drafts, setDrafts] = useState<Drafts>(initial);
  const [spellcheck, setSpellcheck] = useState(true);

  // Undo / redo over the whole text; typing in one passage is grouped per second.
  const history = useRef<{ past: Drafts[]; future: Drafts[]; lastKey: string; lastAt: number }>({ past: [], future: [], lastKey: "", lastAt: 0 });
  // History lives outside state updaters, which React may run twice.
  const latest = useRef<Drafts>(initial);
  const apply = useCallback((next: Drafts, key = "") => {
    const h = history.current;
    const prev = latest.current;
    if (next === prev) return;
    const now = Date.now();
    if (!key || key !== h.lastKey || now - h.lastAt > 1000) h.past.push(prev);
    if (h.past.length > 200) h.past.shift();
    h.future = [];
    h.lastKey = key;
    h.lastAt = now;
    latest.current = next;
    setDrafts(next);
  }, []);
  const undo = useCallback(() => {
    const h = history.current;
    const prev = h.past.pop();
    if (!prev) return;
    h.future.push(latest.current);
    h.lastKey = "";
    latest.current = prev;
    setDrafts(prev);
  }, []);
  const redo = useCallback(() => {
    const h = history.current;
    const next = h.future.pop();
    if (!next) return;
    h.past.push(latest.current);
    h.lastKey = "";
    latest.current = next;
    setDrafts(next);
  }, []);

  // The passage being edited and its selection, for case changes, clean-up and special characters.
  const caret = useRef<Caret | null>(null);
  const areas = useRef(new Map<string, HTMLTextAreaElement>());
  const track = (id: string, el: HTMLTextAreaElement) => {
    caret.current = { id, start: el.selectionStart, end: el.selectionEnd };
  };
  const restoreCaret = (id: string, start: number, end: number) =>
    requestAnimationFrame(() => {
      const el = areas.current.get(id);
      if (!el) return;
      el.focus();
      el.setSelectionRange(start, end);
      caret.current = { id, start, end };
    });

  const dirty = useMemo(() => reader.items.filter((i) => drafts[i.id] !== initial[i.id]).map((i) => i.id), [drafts, initial, reader.items]);
  const words = useMemo(() => Object.values(drafts).reduce((n, t) => n + countWords(t), 0), [drafts]);

  // Find and replace.
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [opts, setOpts] = useState<FindOptions>({});
  const [onlyMatching, setOnlyMatching] = useState(false);
  const [current, setCurrent] = useState(0);
  const findRef = useRef<HTMLInputElement>(null);
  const matches = useMemo(
    () => (query ? reader.items.flatMap((i) => findMatches(drafts[i.id] ?? "", query, opts).map((at) => ({ id: i.id, at }))) : []),
    [query, opts, drafts, reader.items],
  );
  useEffect(() => setCurrent(0), [query, opts]);
  const goTo = (n: number) => {
    if (matches.length === 0) return;
    const k = ((n % matches.length) + matches.length) % matches.length;
    setCurrent(k);
    const m = matches[k];
    const el = areas.current.get(m.id);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    // Keep the typing focus in the find box: select the match without focusing the passage.
    el?.setSelectionRange(m.at, m.at + query.length);
    caret.current = { id: m.id, start: m.at, end: m.at + query.length };
  };
  const replaceCurrent = () => {
    const m = matches[current];
    if (!m) return;
    const text = drafts[m.id];
    const found = findMatches(text, query, opts).includes(m.at);
    if (!found) return;
    apply({ ...latest.current, [m.id]: text.slice(0, m.at) + replacement + text.slice(m.at + query.length) });
  };
  const replaceEverywhere = () => {
    let total = 0;
    const next: Drafts = { ...latest.current };
    for (const i of reader.items) {
      const r = replaceAll(next[i.id] ?? "", query, replacement, opts);
      if (r.count > 0) {
        next[i.id] = r.text;
        total += r.count;
      }
    }
    if (total === 0) return toast.info("No match to replace.");
    apply(next);
    toast.success(`${total} replacement${total > 1 ? "s" : ""}.`);
  };

  // Tools on the current passage (its selection, or all of it) or on the whole text.
  const withPassage = (fn: (text: string) => string) => {
    const c = caret.current;
    if (!c || drafts[c.id] === undefined) return toast.info("Click in a passage first.");
    const text = drafts[c.id];
    const hasSelection = c.end > c.start;
    const part = hasSelection ? text.slice(c.start, c.end) : text;
    const changed = fn(part);
    if (changed === part) return;
    apply({ ...latest.current, [c.id]: hasSelection ? text.slice(0, c.start) + changed + text.slice(c.end) : changed });
    if (hasSelection) restoreCaret(c.id, c.start, c.start + changed.length);
  };
  const everywhere = (fn: (text: string) => string, what: string) => {
    const next: Drafts = {};
    let n = 0;
    for (const i of reader.items) {
      const before = drafts[i.id] ?? "";
      next[i.id] = fn(before);
      if (next[i.id] !== before) n++;
    }
    if (n === 0) return toast.info(`Nothing to change: ${what}.`);
    apply(next);
    toast.success(`${what}: ${n} passage${n > 1 ? "s" : ""} changed. Undo is available.`);
  };
  const insert = (chars: string) => {
    const c = caret.current;
    if (!c || drafts[c.id] === undefined) return toast.info("Click in a passage where the character should go.");
    const text = drafts[c.id];
    apply({ ...latest.current, [c.id]: text.slice(0, c.start) + chars + text.slice(c.end) });
    restoreCaret(c.id, c.start + chars.length, c.start + chars.length);
  };

  async function onSave() {
    if (dirty.length === 0) return onClose();
    const empty = isOriginal && dirty.some((id) => !drafts[id].trim());
    if (empty) return toast.error("A passage of the original cannot be empty: write at least one word, or restore it.");
    try {
      const r = await save.mutateAsync({ lang, edits: dirty.map((id) => ({ id, text: drafts[id] })) });
      toast.success(
        `${r.saved} passage${r.saved === 1 ? "" : "s"} saved${r.reindexed ? `; search updated for ${r.reindexed} passage${r.reindexed === 1 ? "" : "s"}` : ""}.`,
      );
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the text");
    }
  }
  async function onCancel() {
    if (dirty.length > 0) {
      const ok = await confirm({
        title: "Discard your changes?",
        description: `${dirty.length} passage${dirty.length > 1 ? "s were" : " was"} changed and not saved.`,
        confirmLabel: "Discard",
        destructive: true,
      });
      if (!ok) return;
    }
    onClose();
  }

  // Keyboard: Ctrl+S save, Ctrl+Z / Ctrl+Y undo and redo, Ctrl+F / Ctrl+H find and replace.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === "s") {
      e.preventDefault();
      void onSave();
    } else if (k === "z" && !e.shiftKey) {
      e.preventDefault();
      undo();
    } else if (k === "y" || (k === "z" && e.shiftKey)) {
      e.preventDefault();
      redo();
    } else if (k === "f" || k === "h") {
      e.preventDefault();
      setFindOpen(true);
      requestAnimationFrame(() => findRef.current?.select());
    }
  };
  useEffect(() => {
    if (dirty.length === 0) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty.length]);

  const matchIds = useMemo(() => new Set(matches.map((m) => m.id)), [matches]);
  const shown = onlyMatching && query ? reader.items.filter((i) => matchIds.has(i.id)) : reader.items;
  const h = history.current;
  const tool = "h-8 gap-1.5 px-2 text-xs";

  return (
    <div className="space-y-2" onKeyDown={onKeyDown}>
      <div className="sticky top-0 z-10 space-y-2 rounded-lg border border-border bg-background/95 p-2 backdrop-blur" role="toolbar" aria-label="Text editing tools">
        <div className="flex flex-wrap items-center gap-1">
          <Badge variant="secondary" className="mr-1">
            Editing {languageLabel(lang)} {isOriginal ? "(original)" : "(translation)"}
          </Badge>
          <Button variant="ghost" size="sm" className={tool} onClick={undo} disabled={h.past.length === 0} title="Undo (Ctrl+Z)" aria-label="Undo">
            <Undo2 className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="sm" className={tool} onClick={redo} disabled={h.future.length === 0} title="Redo (Ctrl+Y)" aria-label="Redo">
            <Redo2 className="h-4 w-4" aria-hidden="true" />
          </Button>
          <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
          <Button
            variant={findOpen ? "secondary" : "ghost"}
            size="sm"
            className={tool}
            onClick={() => {
              setFindOpen((o) => !o);
              requestAnimationFrame(() => findRef.current?.select());
            }}
            title="Find and replace (Ctrl+F)"
          >
            <Search className="h-4 w-4" aria-hidden="true" /> Find
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className={tool} title="Change case of the selection (or of the passage)" onMouseDown={(e) => e.preventDefault()}>
                <CaseSensitive className="h-4 w-4" aria-hidden="true" /> Case
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Selection, or the whole passage</DropdownMenuLabel>
              {(
                [
                  ["upper", "UPPERCASE"],
                  ["lower", "lowercase"],
                  ["sentence", "Sentence case"],
                  ["title", "Title Case"],
                ] as [CaseStyle, string][]
              ).map(([style, label]) => (
                <DropdownMenuItem key={style} onSelect={() => withPassage((t) => changeCase(t, style, lang))}>
                  {label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className={tool} title="Clean up OCR and transcription artefacts" onMouseDown={(e) => e.preventDefault()}>
                <Wand2 className="h-4 w-4" aria-hidden="true" /> Clean up
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72">
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">This passage (or the selection)</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => withPassage((t) => cleanUpText(t, lang))}>All clean-ups</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => withPassage(joinBrokenWords)}>Join broken words (remov- ing → removing)</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => withPassage(joinBrokenLines)}>Join lines broken mid-sentence</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => withPassage((t) => tidySpaces(t, lang))}>Remove extra spaces</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">The whole text</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => everywhere((t) => cleanUpText(t, lang), "All clean-ups")}>All clean-ups</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => everywhere(joinBrokenWords, "Broken words joined")}>Join broken words</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => everywhere(joinBrokenLines, "Broken lines joined")}>Join broken lines</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => everywhere((t) => tidySpaces(t, lang), "Extra spaces removed")}>Remove extra spaces</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className={tool} title="Insert a special character" onMouseDown={(e) => e.preventDefault()}>
                <Omega className="h-4 w-4" aria-hidden="true" /> Characters
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72">
              {SPECIAL_CHARACTERS.map((group) => (
                <div key={group.label} className="px-1 pb-1">
                  <DropdownMenuLabel className="px-1 text-xs font-normal text-muted-foreground">{group.label}</DropdownMenuLabel>
                  <div className="grid grid-cols-8 gap-0.5">
                    {group.chars.map((ch) => (
                      <DropdownMenuItem key={ch} className="justify-center p-1 text-base" onSelect={() => insert(ch)} aria-label={`Insert ${ch}`}>
                        {ch}
                      </DropdownMenuItem>
                    ))}
                  </div>
                </div>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant={spellcheck ? "secondary" : "ghost"}
            size="sm"
            className={tool}
            aria-pressed={spellcheck}
            onClick={() => setSpellcheck((s) => !s)}
            title={`Underline spelling mistakes in ${languageLabel(lang)} (right-click a word for suggestions)`}
          >
            <SpellCheck className="h-4 w-4" aria-hidden="true" /> Spelling
          </Button>
          <span className="ml-auto flex items-center gap-2">
            <span className="text-xs tabular-nums text-muted-foreground">
              {words.toLocaleString()} words{dirty.length > 0 ? ` · ${dirty.length} changed` : ""}
            </span>
            <Button variant="ghost" size="sm" className={tool} onClick={() => void onCancel()} disabled={save.isPending}>
              <X className="h-4 w-4" aria-hidden="true" /> Cancel
            </Button>
            <Button size="sm" className="h-8 gap-1.5" onClick={() => void onSave()} disabled={save.isPending} title="Save (Ctrl+S)">
              {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
              Save
            </Button>
          </span>
        </div>

        {findOpen && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-2">
            <Input
              ref={findRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  goTo(e.shiftKey ? current - 1 : current + (matches.length && caret.current ? 1 : 0));
                } else if (e.key === "Escape") setFindOpen(false);
              }}
              placeholder="Find"
              aria-label="Find"
              className="h-8 w-44"
            />
            <Input
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              placeholder="Replace with"
              aria-label="Replace with"
              className="h-8 w-44"
            />
            <span className="min-w-16 text-xs tabular-nums text-muted-foreground" aria-live="polite">
              {query ? (matches.length ? `${current + 1} of ${matches.length}` : "No match") : ""}
            </span>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => goTo(current - 1)} disabled={!matches.length} aria-label="Previous match">
              <ChevronUp className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => goTo(current + 1)} disabled={!matches.length} aria-label="Next match">
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={replaceCurrent} disabled={!matches.length}>
              Replace
            </Button>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={replaceEverywhere} disabled={!matches.length}>
              Replace all
            </Button>
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              <input type="checkbox" checked={Boolean(opts.matchCase)} onChange={(e) => setOpts((o) => ({ ...o, matchCase: e.target.checked }))} /> Match case
            </label>
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              <input type="checkbox" checked={Boolean(opts.wholeWord)} onChange={(e) => setOpts((o) => ({ ...o, wholeWord: e.target.checked }))} /> Whole word
            </label>
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              <input type="checkbox" checked={onlyMatching} onChange={(e) => setOnlyMatching(e.target.checked)} /> Only passages with a match
            </label>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">
          {isOriginal
            ? "Corrections update search, citations and future study material. Reprocessing or a new OCR scan replaces them."
            : "Corrections are kept with this translation; translating into this language again replaces them."}
        </p>
      </div>

      <div className="space-y-1" role="list" aria-label="Text to edit">
        {shown.map((item) => {
          const text = drafts[item.id] ?? "";
          const changed = text !== initial[item.id];
          const current_ = matches[current];
          return (
            <div key={item.id} role="listitem" className={cn("flex items-start gap-2 rounded-lg px-2 py-1.5", changed && "bg-primary/5")}>
              <span className="mt-2 w-12 shrink-0 text-right font-mono text-[11px] text-muted-foreground">
                {item.startMs != null && reader.kind === "segments" ? formatTimestamp(item.startMs) : item.page != null ? `p. ${item.page}` : `§${item.index + 1}`}
              </span>
              <textarea
                ref={(el) => {
                  if (el) areas.current.set(item.id, el);
                  else areas.current.delete(item.id);
                }}
                value={text}
                lang={lang}
                spellCheck={spellcheck}
                rows={Math.max(1, Math.min(30, Math.ceil(text.length / 95) + (text.match(/\n/g)?.length ?? 0)))}
                onChange={(e) => {
                  apply({ ...latest.current, [item.id]: e.target.value }, item.id);
                  track(item.id, e.target);
                }}
                onSelect={(e) => track(item.id, e.currentTarget)}
                onFocus={(e) => track(item.id, e.currentTarget)}
                aria-label={`Text ${item.page != null ? `of page ${item.page}` : `at ${item.index + 1}`}`}
                className={cn(
                  "min-w-0 flex-1 resize-y rounded-md border border-input bg-background px-2.5 py-1.5 text-sm leading-relaxed shadow-sm [field-sizing:content] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  current_?.id === item.id && "ring-1 ring-[hsl(var(--citation))]",
                  isOriginal && !text.trim() && "border-destructive",
                )}
              />
              <span className="mt-1 flex w-14 shrink-0 flex-col items-start gap-1">
                {changed ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    title="Restore this passage as it was when you opened the editor"
                    aria-label="Restore this passage"
                    onClick={() => apply({ ...latest.current, [item.id]: initial[item.id] })}
                  >
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                ) : item.edited?.includes(lang) ? (
                  <Badge variant="muted" className="text-[10px]" title="Corrected by hand earlier">
                    edited
                  </Badge>
                ) : null}
              </span>
            </div>
          );
        })}
        {shown.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No passage contains “{query}”.</p>}
      </div>
    </div>
  );
}
