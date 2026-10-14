"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  CheckCheck,
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
} from "@/hooks/use-api";
import { cn } from "@/lib/utils";

const CARD_TYPES = ["basic", "cloze", "equation", "image_label", "code_completion", "conceptual"];

export default function FlashcardsPage() {
  const { studySetId } = useParams<{ studySetId: string }>();
  const { data, isLoading } = useDecks(studySetId);
  const [reviewDeckId, setReviewDeckId] = useState<string | null>(null);

  if (reviewDeckId) {
    return <ReviewSession studySetId={studySetId} deckId={reviewDeckId} onExit={() => setReviewDeckId(null)} />;
  }

  return (
    <div className="space-y-6">
      <DeckPanel studySetId={studySetId} decks={data?.decks} isLoading={isLoading} onReview={setReviewDeckId} />
    </div>
  );
}

/* ------------------------------ decks overview ----------------------------- */

function DeckPanel({
  studySetId,
  decks,
  isLoading,
  onReview,
}: {
  studySetId: string;
  decks?: { id: string; name: string; algorithm: string; total: number; due: number; suspended: number; byType?: Record<string, number> }[];
  isLoading: boolean;
  onReview: (deckId: string) => void;
}) {
  const generate = useGenerateDeck(studySetId);
  const [genOpen, setGenOpen] = useState(false);
  const [focus, setFocus] = useState("");
  const [count, setCount] = useState(14);
  const [types, setTypes] = useState<string[]>([]);

  const sourcesReady = (decks?.length ?? 0) >= 0; // generation requires indexed sources; button shows clear error otherwise

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
        <Button onClick={() => setGenOpen(true)} disabled={generate.isPending}>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> New deck
        </Button>
      </div>

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
            <Button onClick={() => setGenOpen(true)} disabled={!sourcesReady}>Generate flashcards</Button>
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
                <div className="mt-4 flex gap-2">
                  <Button size="sm" onClick={() => onReview(d.id)} disabled={d.total === 0}>
                    {d.due > 0 ? `Review ${d.due} due` : "Study (all scheduled later)"}
                  </Button>
                </div>
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
            <Button onClick={() => void onGenerate()} disabled={generate.isPending}>
              {generate.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              Generate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ------------------------------ review session ----------------------------- */

const GRADES: { grade: 1 | 2 | 3 | 4; label: string; hint: string; className: string }[] = [
  { grade: 1, label: "Again", hint: "1 — blanked", className: "border-destructive/50 hover:bg-destructive/10 text-destructive" },
  { grade: 2, label: "Hard", hint: "2 — struggled", className: "border-[hsl(var(--warning))]/50 hover:bg-[hsl(var(--warning))]/10" },
  { grade: 3, label: "Good", hint: "3 — recalled", className: "border-primary/50 hover:bg-primary/10" },
  { grade: 4, label: "Easy", hint: "4 — instant", className: "border-[hsl(var(--success))]/50 hover:bg-[hsl(var(--success))]/10" },
];

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

function ReviewSession({ studySetId, deckId, onExit }: { studySetId: string; deckId: string; onExit: () => void }) {
  const { data, isLoading } = useDeck(deckId, true);
  const review = useReviewCard(deckId);
  const editCard = useEditCard(deckId);

  const [queue, setQueue] = useState<FlashcardRow[] | null>(null);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [reviewed, setReviewed] = useState<{ id: string; grade: number; intervalDays: number }[]>([]);
  const [lastInterval, setLastInterval] = useState<number | null>(null);

  const dueCards = useMemo(() => (data?.cards ?? []).filter((c) => !c.suspended), [data]);

  useEffect(() => {
    if (queue === null && data?.cards) {
      // First due-only fetch seeds the session; new due after grading stay out (already seen).
      setQueue(dueCards);
    }
  }, [data?.cards, dueCards, queue]);

  const card = queue?.[index];
  const done = queue !== null && index >= queue.length;

  const grade = useCallback(
    async (g: 1 | 2 | 3 | 4) => {
      if (!card) return;
      try {
        const res = await review.mutateAsync({ cardId: card.id, grade: g });
        setReviewed((prev) => [...prev, { id: card.id, grade: g, intervalDays: res.intervalDays }]);
        setLastInterval(res.intervalDays);
        setRevealed(false);
        setIndex((i) => i + 1);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Review failed");
      }
    },
    [card, review],
  );

  // Keyboard: space = reveal, 1–4 = grade.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === "Space" && card && !revealed) {
        e.preventDefault();
        setRevealed(true);
      } else if (revealed && ["1", "2", "3", "4"].includes(e.key)) {
        e.preventDefault();
        void grade(Number(e.key) as 1 | 2 | 3 | 4);
      } else if (e.key === "Escape") {
        onExit();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [card, revealed, grade, onExit]);

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
              setReviewed([]);
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

  if (done) {
    const again = reviewed.filter((r) => r.grade === 1).length;
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
          <Sparkles className="h-6 w-6 text-primary" aria-hidden="true" />
          <div>
            <p className="text-lg font-semibold">Session complete</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {reviewed.length} reviewed · {again} lapsed{again > 0 ? " — those return soon" : ""}
            </p>
          </div>
          <Button onClick={onExit}>Back to decks</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <Button variant="ghost" size="sm" onClick={onExit}>← Exit session</Button>
        <span className="tabular-nums" aria-live="polite">
          {index + 1} / {queue.length}
        </span>
      </div>
      <Progress value={(index / queue.length) * 100} />

      <Card className="min-h-[320px]">
        <CardContent className="flex flex-col py-8">
          <div className="mb-3 flex items-center justify-between">
            <Badge variant="secondary">{card!.type.replace(/_/g, " ")}</Badge>
            <Badge variant="outline" className="text-[10px]">{card!.state.toLowerCase()}</Badge>
          </div>
          <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
            <Markdown content={card!.front} className="text-lg" />
            {revealed ? (
              <div className="w-full space-y-4 border-t border-border pt-6">
                <Markdown content={card!.back} />
                {card!.anchors.length > 0 && (
                  <div className="flex flex-col items-center gap-1.5">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Source</p>
                    <CitationList anchors={anchorsFrom(card!.anchors)} studySetId={studySetId} max={3} size="default" />
                  </div>
                )}
              </div>
            ) : (
              <Button variant="outline" onClick={() => setRevealed(true)} className="gap-2">
                <Eye className="h-4 w-4" aria-hidden="true" /> Show answer <kbd className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">space</kbd>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {revealed && (
        <div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {GRADES.map((g) => (
              <Button key={g.grade} variant="outline" onClick={() => void grade(g.grade)} disabled={review.isPending} className={cn("flex flex-col gap-0.5 py-3", g.className)}>
                <span className="text-sm font-medium">{g.label}</span>
                <span className="text-[10px] opacity-70">{g.hint}</span>
              </Button>
            ))}
          </div>
          {lastInterval != null && (
            <p className="mt-2 text-center text-xs text-muted-foreground" aria-live="polite">
              Previous card: next review in {lastInterval < 1 ? "<1 day" : `${Math.round(lastInterval)} days`}
            </p>
          )}
          <div className="mt-3 flex justify-center">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-muted-foreground"
              onClick={() =>
                void editCard
                  .mutateAsync({ cardId: card!.id, suspended: true })
                  .then(() => toast.success("Card suspended — excluded from reviews"))
                  .catch((err) => toast.error(err instanceof Error ? err.message : "Failed"))
                  .finally(() => {
                    setRevealed(false);
                    setIndex((i) => i + 1);
                  })
              }
            >
              <PauseCircle className="h-3.5 w-3.5" aria-hidden="true" /> Suspend this card
            </Button>
          </div>
        </div>
      )}
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
