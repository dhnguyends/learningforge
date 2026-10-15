"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Eye,
  Layers,
  Loader2,
  PauseCircle,
  Plus,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Markdown } from "@/components/shared/markdown";
import { CitationList, type AnchorData } from "@/components/shared/citation-chip";
import {
  useDecks,
  useDeck,
  useGenerateDeck,
  useReviewCard,
  useEditCard,
  type FlashcardRow,
  type AnchorRef,
  useIndexingReadiness,
} from "@/hooks/use-api";
import { IndexingNotice } from "@/components/study/indexing-notice";
import { cn } from "@/lib/utils";
import { CLOZE_BLANK, clozeAnswer, clozeBack, clozeFront, hasCloze } from "@/lib/cloze";

const CARD_TYPES = ["basic", "cloze", "equation", "image_label", "code_completion", "conceptual"];

export default function FlashcardsPage() {
  const { studySetId } = useParams<{ studySetId: string }>();
  const { data, isLoading } = useDecks(studySetId);
  const [session, setSession] = useState<{ mode: "review" | "browse"; deckId: string } | null>(null);

  if (session?.mode === "review") {
    return <ReviewSession studySetId={studySetId} deckId={session.deckId} onExit={() => setSession(null)} />;
  }
  if (session?.mode === "browse") {
    return <BrowseSession studySetId={studySetId} deckId={session.deckId} onExit={() => setSession(null)} />;
  }

  return (
    <div className="space-y-6">
      <DeckPanel
        studySetId={studySetId}
        decks={data?.decks}
        isLoading={isLoading}
        onReview={(deckId) => setSession({ mode: "review", deckId })}
        onBrowse={(deckId) => setSession({ mode: "browse", deckId })}
      />
    </div>
  );
}

/* ------------------------------ decks overview ----------------------------- */

function DeckPanel({
  studySetId,
  decks,
  isLoading,
  onReview,
  onBrowse,
}: {
  studySetId: string;
  decks?: { id: string; name: string; algorithm: string; total: number; due: number; suspended: number; byType?: Record<string, number> }[];
  isLoading: boolean;
  onReview: (deckId: string) => void;
  onBrowse: (deckId: string) => void;
}) {
  const generate = useGenerateDeck(studySetId);
  const readiness = useIndexingReadiness(studySetId);
  // Generation waits until every source is vectorized and indexed.
  const canGenerate = readiness.data?.ready === true;
  const [genOpen, setGenOpen] = useState(false);
  const [focus, setFocus] = useState("");
  const [count, setCount] = useState(14);
  const [types, setTypes] = useState<string[]>([]);


  async function onGenerate() {
    try {
      await generate.mutateAsync({
        focus: focus.trim() || undefined,
        count,
        ...(types.length > 0 ? { cardTypes: types } : {}),
      });
      toast.success("Flashcard generation started");
      setGenOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start generation");
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Flashcards</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Scheduled with FSRS-4.5 at ~90% target retention. Every card cites the source it came from.
          </p>
        </div>
        <Button onClick={() => setGenOpen(true)} disabled={generate.isPending || !canGenerate}>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> New deck
        </Button>
      </div>

      <IndexingNotice readiness={readiness.data} />

      {isLoading ? (
        <div className="h-32 animate-pulse rounded-lg bg-muted" />
      ) : (decks ?? []).length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="rounded-full bg-primary/10 p-3 text-primary"><Layers className="h-6 w-6" aria-hidden="true" /></div>
            <div>
              <p className="font-medium">No decks yet</p>
              <p className="mt-1 text-sm text-muted-foreground">Generate a deck from your indexed sources — cloze, equations, code, concepts.</p>
            </div>
            <Button onClick={() => setGenOpen(true)} disabled={!canGenerate}>Generate flashcards</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {(decks ?? []).map((d) => (
            <Card key={d.id} className="transition-colors hover:border-primary/40">
              <CardContent className="py-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{d.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {d.total} cards · {d.algorithm} · {d.suspended} suspended
                    </p>
                  </div>
                  {d.due > 0 && <Badge variant="citation">{d.due} due</Badge>}
                </div>
                {d.byType && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {Object.entries(d.byType).map(([t, n]) => (
                      <Badge key={t} variant="secondary" className="text-[10px]">{t.replace(/_/g, " ")} × {n}</Badge>
                    ))}
                  </div>
                )}
                <div className="mt-4 flex flex-wrap gap-2">
                  {d.due > 0 && (
                    <Button size="sm" onClick={() => onReview(d.id)}>
                      Review {d.due} due
                    </Button>
                  )}
                  <Button size="sm" variant={d.due > 0 ? "outline" : "default"} onClick={() => onBrowse(d.id)} disabled={d.total === 0}>
                    <Layers className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Browse cards
                  </Button>
                </div>
                {d.due === 0 && d.total > 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">Nothing due — FSRS schedules these for later. Browse to study them anyway.</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={genOpen} onOpenChange={setGenOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate flashcards</DialogTitle>
            <DialogDescription>Written from your indexed sources, deduplicated, each with citations.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="focus">Focus (optional)</Label>
              <Input id="focus" value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="e.g. optimization methods from week 3" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="count">Cards: {count}</Label>
              <input id="count" type="range" min={4} max={40} value={count} onChange={(e) => setCount(Number(e.target.value))} className="w-full accent-[hsl(var(--primary))]" />
            </div>
            <div className="space-y-1.5">
              <Label>Card types (leave empty for a mix)</Label>
              <div className="flex flex-wrap gap-1.5">
                {CARD_TYPES.map((t) => {
                  const active = types.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setTypes((prev) => (active ? prev.filter((x) => x !== t) : [...prev, t]))}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-xs transition-colors",
                        active ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40",
                      )}
                    >
                      {t.replace(/_/g, " ")}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setGenOpen(false)}>Cancel</Button>
            <Button onClick={() => void onGenerate()} disabled={generate.isPending || !canGenerate}>
              {generate.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              Generate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ------------------------------ card viewer -------------------------------- */

const GRADES: { grade: 1 | 2 | 3 | 4; label: string; hint: string; className: string }[] = [
  { grade: 1, label: "Again", hint: "1 — blanked", className: "border-destructive/50 hover:bg-destructive/10 text-destructive" },
  { grade: 2, label: "Hard", hint: "2 — struggled", className: "border-[hsl(var(--warning))]/50 hover:bg-[hsl(var(--warning))]/10" },
  { grade: 3, label: "Good", hint: "3 — recalled", className: "border-primary/50 hover:bg-primary/10" },
  { grade: 4, label: "Easy", hint: "4 — instant", className: "border-[hsl(var(--success))]/50 hover:bg-[hsl(var(--success))]/10" },
];
const GRADE_LABEL: Record<number, string> = { 1: "Again", 2: "Hard", 3: "Good", 4: "Easy" };

function anchorsFrom(refs: AnchorRef[] | undefined): AnchorData[] {
  return (refs ?? []).map((a) => ({
    id: a.id,
    sourceId: a.sourceId,
    sourceTitle: a.source?.title ?? "Source",
    sourceType: a.source?.type ?? "",
    startMs: a.startMs,
    endMs: a.endMs,
    page: a.page,
    excerpt: a.excerpt,
  }));
}

/**
 * One card at a time: Previous / Next arrows (and ←/→ keys), a position
 * counter + progress bar, click or Space to flip. Cloze blanks ({{answer}})
 * are hidden on the front and filled in on the back.
 */
function CardViewer({
  studySetId,
  cards,
  index,
  onIndexChange,
  revealed,
  onRevealedChange,
  badge,
  footer,
}: {
  studySetId: string;
  cards: FlashcardRow[];
  index: number;
  onIndexChange: (index: number) => void;
  revealed: boolean;
  onRevealedChange: (revealed: boolean) => void;
  badge?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const card = cards[index];
  const hasPrev = index > 0;
  const hasNext = index < cards.length - 1;
  const go = useCallback(
    (to: number) => {
      if (to < 0 || to >= cards.length) return;
      onRevealedChange(false);
      onIndexChange(to);
    },
    [cards.length, onIndexChange, onRevealedChange],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        go(index - 1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        go(index + 1);
      } else if (e.code === "Space") {
        e.preventDefault();
        onRevealedChange(!revealed);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, index, revealed, onRevealedChange]);

  if (!card) return null;
  const cloze = hasCloze(card.front);
  const front = cloze ? clozeFront(card.front) : card.front;
  // A cloze card's answer IS its front with the blanks filled in.
  const answer = cloze ? clozeBack(card.front) : card.back;
  // Show a cloze card's back only when it adds something beyond the blanks' answers.
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const blankAnswers = norm([...card.front.matchAll(CLOZE_BLANK)].map((m) => clozeAnswer(m[1])).join(" "));
  const extra = cloze && card.back.trim() && norm(card.back) !== blankAnswers && norm(card.back) !== norm(card.front) ? card.back : null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span className="tabular-nums" aria-live="polite">
          Card {index + 1} / {cards.length}
        </span>
        <span className="hidden text-xs sm:inline">← → to move · space to flip</span>
      </div>
      <Progress value={((index + 1) / cards.length) * 100} />

      <div className="flex items-stretch gap-2 sm:gap-3">
        <Button
          variant="outline"
          size="icon"
          className="h-auto w-10 shrink-0 self-center sm:h-12 sm:w-12"
          onClick={() => go(index - 1)}
          disabled={!hasPrev}
          aria-label="Previous card"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
        </Button>

        <Card
          className="min-h-[320px] flex-1 cursor-pointer select-text transition-shadow hover:shadow-md"
          onClick={(e) => {
            // Don't flip when the click was on a citation chip / link inside the card.
            if ((e.target as HTMLElement).closest("a,button")) return;
            onRevealedChange(!revealed);
          }}
          role="button"
          aria-label={revealed ? "Hide answer" : "Show answer"}
        >
          <CardContent className="flex h-full flex-col py-8">
            <div className="mb-3 flex items-center justify-between gap-2">
              <Badge variant="secondary">{card.type.replace(/_/g, " ").toLowerCase()}</Badge>
              <div className="flex items-center gap-1.5">
                {badge}
                {card.suspended && <Badge variant="outline" className="text-[10px]">suspended</Badge>}
                <Badge variant="outline" className="text-[10px]">{card.state.toLowerCase()}</Badge>
              </div>
            </div>
            <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
              <Markdown content={revealed && cloze ? answer : front} className="text-lg" />
              {revealed ? (
                <div className="w-full space-y-4 border-t border-border pt-6">
                  {!cloze && <Markdown content={answer} />}
                  {extra && <Markdown content={extra} className="text-sm text-muted-foreground" />}
                  {card.anchors.length > 0 && (
                    <div className="flex flex-col items-center gap-1.5">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Source</p>
                      <CitationList anchors={anchorsFrom(card.anchors)} studySetId={studySetId} max={3} size="default" />
                    </div>
                  )}
                </div>
              ) : (
                <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                  <Eye className="h-4 w-4" aria-hidden="true" /> Click or press <kbd className="rounded bg-muted px-1.5 py-0.5 text-[10px]">space</kbd> to show the answer
                </span>
              )}
            </div>
          </CardContent>
        </Card>

        <Button
          variant="outline"
          size="icon"
          className="h-auto w-10 shrink-0 self-center sm:h-12 sm:w-12"
          onClick={() => go(index + 1)}
          disabled={!hasNext}
          aria-label="Next card"
        >
          <ChevronRight className="h-5 w-5" aria-hidden="true" />
        </Button>
      </div>

      {footer}
    </div>
  );
}

/* ------------------------------ browse session ----------------------------- */

/** Every card of a deck, in order — no grading, no scheduling side effects. */
function BrowseSession({ studySetId, deckId, onExit }: { studySetId: string; deckId: string; onExit: () => void }) {
  const { data, isLoading } = useDeck(deckId, false);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const cards = data?.cards ?? [];

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onExit();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onExit]);

  if (isLoading) return <div className="h-64 animate-pulse rounded-lg bg-muted" />;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={onExit}>← Back to decks</Button>
        <p className="truncate text-sm font-medium">{data?.deck.name}</p>
      </div>
      {cards.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">This deck has no cards.</CardContent>
        </Card>
      ) : (
        <CardViewer
          studySetId={studySetId}
          cards={cards}
          index={Math.min(index, cards.length - 1)}
          onIndexChange={setIndex}
          revealed={revealed}
          onRevealedChange={setRevealed}
        />
      )}
    </div>
  );
}

/* ------------------------------ review session ----------------------------- */

function ReviewSession({ studySetId, deckId, onExit }: { studySetId: string; deckId: string; onExit: () => void }) {
  const { data, isLoading } = useDeck(deckId, true);
  const review = useReviewCard(deckId);
  const editCard = useEditCard(deckId);

  const [queue, setQueue] = useState<FlashcardRow[] | null>(null);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  // Grades given this session, by card id — a graded card can be revisited
  // with the arrows but not graded twice (that would double-schedule it).
  const [graded, setGraded] = useState<Record<string, { grade: number; intervalDays: number }>>({});
  const [finished, setFinished] = useState(false);

  const dueCards = useMemo(() => (data?.cards ?? []).filter((c) => !c.suspended), [data]);

  useEffect(() => {
    if (queue === null && data?.cards) {
      // First due-only fetch seeds the session; new due after grading stay out (already seen).
      setQueue(dueCards);
    }
  }, [data?.cards, dueCards, queue]);

  const card = queue?.[index];
  const gradedCount = Object.keys(graded).length;

  const grade = useCallback(
    async (g: 1 | 2 | 3 | 4) => {
      if (!card || graded[card.id] || !queue) return;
      try {
        const res = await review.mutateAsync({ cardId: card.id, grade: g });
        const next = { ...graded, [card.id]: { grade: g, intervalDays: res.intervalDays } };
        setGraded(next);
        setRevealed(false);
        // Advance to the next ungraded card; finish when none remain.
        const after = queue.findIndex((c, i) => i > index && !next[c.id]);
        const before = queue.findIndex((c) => !next[c.id]);
        if (after !== -1) setIndex(after);
        else if (before !== -1) setIndex(before);
        else setFinished(true);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Review failed");
      }
    },
    [card, graded, index, queue, review],
  );

  // Keyboard: 1–4 = grade (arrows and space are handled by the viewer).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (revealed && card && !graded[card.id] && ["1", "2", "3", "4"].includes(e.key)) {
        e.preventDefault();
        void grade(Number(e.key) as 1 | 2 | 3 | 4);
      } else if (e.key === "Escape") {
        onExit();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [card, revealed, graded, grade, onExit]);

  if (isLoading || queue === null) {
    return <div className="h-64 animate-pulse rounded-lg bg-muted" />;
  }

  if (queue.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <CheckCheck className="h-6 w-6 text-[hsl(var(--success))]" aria-hidden="true" />
          <p className="font-medium">Nothing due in this deck</p>
          <p className="text-sm text-muted-foreground">FSRS will resurface these cards as their retrievability drops.</p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => {
              setQueue(dueCards);
              setIndex(0);
              setGraded({});
              setRevealed(false);
            }}>
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Refresh due
            </Button>
            <Button variant="ghost" onClick={onExit}>Back to decks</Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (finished || !card) {
    const again = Object.values(graded).filter((r) => r.grade === 1).length;
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
          <Sparkles className="h-6 w-6 text-primary" aria-hidden="true" />
          <div>
            <p className="text-lg font-semibold">Session complete</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {gradedCount} reviewed · {again} lapsed{again > 0 ? " — those return soon" : ""}
            </p>
          </div>
          <Button onClick={onExit}>Back to decks</Button>
        </CardContent>
      </Card>
    );
  }

  const done = graded[card.id];

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <Button variant="ghost" size="sm" onClick={onExit}>← Exit session</Button>
        <span className="tabular-nums">{gradedCount} / {queue.length} graded</span>
      </div>

      <CardViewer
        studySetId={studySetId}
        cards={queue}
        index={index}
        onIndexChange={setIndex}
        revealed={revealed}
        onRevealedChange={setRevealed}
        badge={done ? <Badge variant="citation" className="text-[10px]">graded: {GRADE_LABEL[done.grade]}</Badge> : undefined}
        footer={
          done ? (
            <p className="text-center text-xs text-muted-foreground" aria-live="polite">
              Graded {GRADE_LABEL[done.grade]} — next review in {done.intervalDays < 1 ? "<1 day" : `${Math.round(done.intervalDays)} day${Math.round(done.intervalDays) === 1 ? "" : "s"}`}
            </p>
          ) : revealed ? (
            <div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {GRADES.map((g) => (
                  <Button key={g.grade} variant="outline" onClick={() => void grade(g.grade)} disabled={review.isPending} className={cn("flex flex-col gap-0.5 py-3", g.className)}>
                    <span className="text-sm font-medium">{g.label}</span>
                    <span className="text-[10px] opacity-70">{g.hint}</span>
                  </Button>
                ))}
              </div>
              <div className="mt-3 flex justify-center">
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-muted-foreground"
                  onClick={() =>
                    void editCard
                      .mutateAsync({ cardId: card.id, suspended: true })
                      .then(() => {
                        toast.success("Card suspended — excluded from reviews");
                        setQueue((q) => (q ? q.filter((c) => c.id !== card.id) : q));
                        setIndex((i) => Math.max(0, Math.min(i, queue.length - 2)));
                        setRevealed(false);
                      })
                      .catch((err) => toast.error(err instanceof Error ? err.message : "Failed"))
                  }
                >
                  <PauseCircle className="h-3.5 w-3.5" aria-hidden="true" /> Suspend this card
                </Button>
              </div>
            </div>
          ) : null
        }
      />
    </div>
  );
}

function Progress({ value }: { value: number }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${value}%` }} />
    </div>
  );
}
