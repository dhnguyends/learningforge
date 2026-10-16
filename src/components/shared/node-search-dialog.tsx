"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LEVEL_LABELS, type TaxonomyLevel } from "@/lib/taxonomy/parse";
import { searchNodes, type TreeNode } from "@/lib/taxonomy/tree";
import { cn } from "@/lib/utils";

/**
 * "Go to a node": type any part of a name to list every matching node of the
 * tree, at any level, from top to bottom (case and accents ignored), with its
 * number, level and path. ↑/↓ move, Enter (or a click) jumps to it, Esc closes.
 */
export function NodeSearchDialog<C>({
  open,
  onOpenChange,
  roots,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roots: TreeNode<C>[];
  onPick: (node: TreeNode<C>) => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const matches = useMemo(() => searchNodes(roots, query), [roots, query]);

  // A new search starts at the first match; the active one stays in view.
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function pick(index: number) {
    const match = matches[index];
    if (!match) return;
    onOpenChange(false);
    onPick(match.node);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setQuery("");
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Go to a node</DialogTitle>
          <DialogDescription>
            Type part of a name: every discipline, subject, course / module or topic that contains it is listed from top to bottom.
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((i) => Math.min(i + 1, matches.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                pick(active);
              }
            }}
            placeholder="e.g. kinemat, finance, schrodinger"
            aria-label="Search the tree"
            role="combobox"
            aria-expanded={matches.length > 0}
            aria-controls="node-search-results"
            aria-activedescendant={matches.length > 0 ? `node-search-${active}` : undefined}
            className="pl-8"
            autoFocus
          />
        </div>
        <p className="text-xs text-muted-foreground" role="status">
          {query.trim() ? `${matches.length} match${matches.length === 1 ? "" : "es"}` : "Matches show here as you type."}
        </p>
        <ul
          ref={listRef}
          id="node-search-results"
          role="listbox"
          aria-label="Matching nodes"
          className="scroll-thin max-h-[50vh] overflow-y-auto rounded-md border border-border empty:hidden"
        >
          {matches.map((m, i) => (
            <li
              key={m.node.id}
              id={`node-search-${i}`}
              data-index={i}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(i)}
              className={cn("flex cursor-pointer items-baseline gap-2 px-3 py-1.5 text-sm", i === active && "bg-primary/10")}
            >
              <span className="w-16 shrink-0 font-mono text-[11px] text-muted-foreground">{m.node.code}</span>
              <span className="min-w-0 flex-1">
                <span className="block">
                  {m.node.name.slice(0, m.start)}
                  <mark className="rounded-sm bg-amber-200 px-0.5 text-foreground dark:bg-amber-500/40">
                    {m.node.name.slice(m.start, m.end)}
                  </mark>
                  {m.node.name.slice(m.end)}
                  <span className="ml-2 text-[11px] text-muted-foreground">{LEVEL_LABELS[m.node.level as TaxonomyLevel]}</span>
                </span>
                {m.node.path.length > 1 && (
                  <span className="block truncate text-xs text-muted-foreground">{m.node.path.slice(0, -1).join(" › ")}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
