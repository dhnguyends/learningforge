"use client";

import { useMemo, useState } from "react";
import { ChevronRight, Loader2, Search, Tags, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useClassifyStudySet, useTaxonomy, type Classification } from "@/hooks/use-api";
import { LEVEL_LABELS, type TaxonomyLevel } from "@/lib/taxonomy/parse";
import { buildTree, searchTopics, type TreeNode } from "@/lib/taxonomy/tree";
import { cn } from "@/lib/utils";

/** "Science › Physics › Classical Mechanics › Kinematics", each level named on hover. */
export function ClassificationPath({ classification, className }: { classification: Classification; className?: string }) {
  const levels = [classification.discipline, classification.subject, classification.module, classification.topic];
  return (
    <span className={cn("inline-flex min-w-0 flex-wrap items-center gap-x-1", className)}>
      {levels.map((l, i) => (
        <span key={l.code} className="inline-flex items-center gap-x-1">
          {i > 0 && <ChevronRight className="h-3 w-3 shrink-0 opacity-60" aria-hidden="true" />}
          <span
            title={`${LEVEL_LABELS[(i + 1) as TaxonomyLevel]} ${l.code}`}
            className={i === 3 ? "font-medium text-foreground" : undefined}
          >
            {l.name}
          </span>
        </span>
      ))}
    </span>
  );
}

/** Opens the topic picker for a course (administrators: the API refuses anyone else). */
export function ClassifyButton({
  studySetId,
  title,
  topicId,
  label,
  className,
}: {
  studySetId: string;
  title: string;
  topicId: string | null;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className={cn("gap-1.5", className)}
        onClick={() => setOpen(true)}
        aria-label={`${topicId ? "Change the topic of" : "Choose a topic for"} ${title}`}
      >
        <Tags className="h-3.5 w-3.5" aria-hidden="true" /> {label ?? (topicId ? "Change topic" : "Choose topic")}
      </Button>
      <TopicPickerDialog open={open} onOpenChange={setOpen} studySetId={studySetId} title={title} currentTopicId={topicId} />
    </>
  );
}

/**
 * The main topic of a course (administrators): choosing one files the course
 * under it and fills the three levels above it; "Remove topic" unfiles it.
 */
export function TopicPickerDialog({
  open,
  onOpenChange,
  studySetId,
  title,
  currentTopicId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  studySetId: string;
  title: string;
  currentTopicId: string | null;
}) {
  const classify = useClassifyStudySet();

  async function choose(topic: TreeNode<unknown> | null) {
    try {
      await classify.mutateAsync({ studySetId, topicId: topic?.id ?? null });
      toast.success(topic ? `"${title}" filed under ${topic.path.join(" › ")}` : `"${title}" has no topic now`);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not change the topic");
    }
  }

  return (
    <TopicPicker
      open={open}
      onOpenChange={onOpenChange}
      title="Choose a topic"
      description={
        <>File &ldquo;{title}&rdquo; under a topic. Its discipline, subject and course / module are filled in from the course tree.</>
      }
      currentTopicId={currentTopicId}
      pending={classify.isPending}
      onChoose={(topic) => void choose(topic)}
      onRemove={currentTopicId ? () => void choose(null) : undefined}
      removeLabel="Remove topic"
    />
  );
}

/**
 * Pick a topic (level 4): type to search all topics (each shown with its full
 * path) or browse Discipline › Subject › Course / Module › Topic. Topics in
 * `unavailable` are shown greyed with the reason (e.g. already related).
 */
export function TopicPicker({
  open,
  onOpenChange,
  title,
  description,
  currentTopicId = null,
  unavailable,
  pending,
  onChoose,
  onRemove,
  removeLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  currentTopicId?: string | null;
  /** Topic id → why it cannot be chosen. */
  unavailable?: Map<string, string>;
  pending: boolean;
  onChoose: (topic: TreeNode<unknown>) => void;
  onRemove?: () => void;
  removeLabel?: string;
}) {
  const { data, isLoading, error } = useTaxonomy("mine", open);
  const [query, setQuery] = useState("");
  const tree = useMemo(() => buildTree(data?.nodes ?? [], [] as { topicId: string | null }[]), [data]);
  const results = useMemo(() => searchTopics(tree.byId, query), [tree, query]);
  const current = currentTopicId ? tree.byId.get(currentTopicId) : undefined;
  const pick = (id: string) => {
    const topic = tree.byId.get(id);
    if (topic) onChoose(topic);
  };
  const why = (id: string) => unavailable?.get(id);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (pending) return;
        if (!o) setQuery("");
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {current && (
          <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            Now: <span className="text-foreground">{current.path.join(" › ")}</span>
          </p>
        )}

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search topics, e.g. backpropagation"
            aria-label="Search topics"
            className="pl-8"
            autoFocus
          />
        </div>

        <div className="scroll-thin max-h-[50vh] min-h-[12rem] overflow-y-auto rounded-md border border-border">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading the course tree…
            </div>
          ) : error ? (
            <p className="py-10 text-center text-sm text-destructive">{error.message}</p>
          ) : query.trim() ? (
            results.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">No topic matches &ldquo;{query.trim()}&rdquo;.</p>
            ) : (
              <ul role="listbox" aria-label="Matching topics">
                {results.map((t) => (
                  <li key={t.id} role="option" aria-selected={t.id === currentTopicId} aria-disabled={why(t.id) ? true : undefined}>
                    <TopicButton topic={t} current={t.id === currentTopicId} disabled={pending} why={why(t.id)} onPick={pick} showPath />
                  </li>
                ))}
              </ul>
            )
          ) : (
            <BrowseTree roots={tree.roots} currentTopicId={currentTopicId} disabled={pending} why={why} onPick={pick} />
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {onRemove ? (
            <Button variant="ghost" className="gap-1.5 text-destructive hover:text-destructive" onClick={onRemove} disabled={pending}>
              <X className="h-4 w-4" aria-hidden="true" /> {removeLabel ?? "Remove"}
            </Button>
          ) : (
            <span />
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TopicButton({
  topic,
  current,
  disabled,
  why,
  onPick,
  showPath = false,
}: {
  topic: TreeNode<unknown>;
  current: boolean;
  disabled: boolean;
  /** Why this topic cannot be chosen (greyed out), if so. */
  why?: string;
  onPick: (id: string) => void;
  showPath?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled || why !== undefined}
      title={why}
      onClick={() => onPick(topic.id)}
      className={cn(
        "flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-primary/10 disabled:opacity-50",
        current && "bg-primary/10 font-medium text-primary",
      )}
    >
      <span className="w-16 shrink-0 font-mono text-[11px] text-muted-foreground">{topic.code}</span>
      <span className="min-w-0">
        <span className="block">
          {topic.name}
          {why && <span className="ml-2 text-[11px] text-muted-foreground">({why})</span>}
        </span>
        {showPath && <span className="block truncate text-xs text-muted-foreground">{topic.path.slice(0, 3).join(" › ")}</span>}
      </span>
    </button>
  );
}

/** Discipline › Subject › Course / Module, collapsible; topics are the choices. */
function BrowseTree({
  roots,
  currentTopicId,
  disabled,
  why,
  onPick,
}: {
  roots: TreeNode<unknown>[];
  currentTopicId: string | null;
  disabled: boolean;
  why: (id: string) => string | undefined;
  onPick: (id: string) => void;
}) {
  // The current topic's branch starts open.
  const [open, setOpen] = useState<Set<string>>(() => {
    const ids = new Set<string>();
    const mark = (nodes: TreeNode<unknown>[]): boolean =>
      nodes.some((n) => {
        if (n.id === currentTopicId) return true;
        if (mark(n.children)) {
          ids.add(n.id);
          return true;
        }
        return false;
      });
    mark(roots);
    return ids;
  });
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const render = (nodes: TreeNode<unknown>[], depth: number): React.ReactNode => (
    <ul role={depth === 0 ? "tree" : "group"} aria-label={depth === 0 ? "Course tree" : undefined}>
      {nodes.map((n) =>
        n.level === 4 ? (
          <li key={n.id} role="treeitem" aria-selected={n.id === currentTopicId} style={{ paddingLeft: depth * 16 }}>
            <TopicButton topic={n} current={n.id === currentTopicId} disabled={disabled} why={why(n.id)} onPick={onPick} />
          </li>
        ) : (
          <li key={n.id} role="treeitem" aria-expanded={open.has(n.id)} aria-selected={false}>
            <button
              type="button"
              onClick={() => toggle(n.id)}
              className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-sm hover:bg-muted"
              style={{ paddingLeft: 12 + depth * 16 }}
            >
              <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 transition-transform", open.has(n.id) && "rotate-90")} aria-hidden="true" />
              <span className="w-12 shrink-0 font-mono text-[11px] text-muted-foreground">{n.code}</span>
              <span className={n.level === 1 ? "font-semibold" : n.level === 2 ? "font-medium" : undefined}>{n.name}</span>
            </button>
            {open.has(n.id) && render(n.children, depth + 1)}
          </li>
        ),
      )}
    </ul>
  );
  return <>{render(roots, 0)}</>;
}
