"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Bot, ChevronRight, ChevronsDownUp, ChevronsUpDown, Navigation, Search, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ClassifyButton } from "@/components/shared/topic-picker";
import { NodeSearchDialog } from "@/components/shared/node-search-dialog";
import type { TaxonomyCourse, TaxonomyPayload } from "@/hooks/use-api";
import { LEVEL_LABELS, type TaxonomyLevel } from "@/lib/taxonomy/parse";
import { buildTree, viewTree, type TreeNode } from "@/lib/taxonomy/tree";
import { cn } from "@/lib/utils";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** A per-browser boolean (localStorage), e.g. the "Has courses" checkbox. */
function useRememberedFlag(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(key);
      if (stored !== null) setValue(stored === "1");
    } catch {
      /* storage unavailable: keep the default */
    }
  }, [key]);
  const set = (v: boolean) => {
    setValue(v);
    try {
      window.localStorage.setItem(key, v ? "1" : "0");
    } catch {
      /* not remembered, still applied */
    }
  };
  return [value, set];
}

export type CourseTreeNode = TreeNode<TaxonomyCourse>;

/** An input row being typed: the first child of `nodeId`, or its next neighbour. */
export interface TreeDraft {
  nodeId: string;
  insert: "child" | "neighbour";
}

/**
 * The course tree (Discipline › Subject › Course / Module › Topic) with the
 * courses filed under each topic: search, "Has courses", expand / collapse
 * all, and a list of the courses not in the tree yet. Used by Explore and by
 * Admin → Courses Tree (which selects a node and inserts next to it).
 */
export function CourseTreeView({
  data,
  isLoading,
  error,
  canClassify,
  hasCoursesKey,
  hasCoursesDefault,
  toolbarExtra,
  renderCourseActions,
  selectedId,
  onSelect,
  draft,
  renderDraft,
  onNodeMenu,
  onReveal,
}: {
  data: TaxonomyPayload | undefined;
  isLoading: boolean;
  error: Error | null;
  /** Administrators: "Choose topic" / "Move" on every course. */
  canClassify: boolean;
  hasCoursesKey: string;
  hasCoursesDefault: boolean;
  toolbarExtra?: React.ReactNode;
  renderCourseActions?: (course: TaxonomyCourse) => React.ReactNode;
  /** Admin → Courses Tree: rows can be selected; the selected node's branch is kept open. */
  selectedId?: string | null;
  onSelect?: (node: CourseTreeNode) => void;
  /** Where the inline input row goes, and what it shows (given the new node's level). */
  draft?: TreeDraft | null;
  renderDraft?: (level: number) => React.ReactNode;
  /** Right click on a row, or Shift+F10 / the context-menu key on its name: open a menu at `at` (viewport pixels). */
  onNodeMenu?: (node: CourseTreeNode, at: { x: number; y: number }) => void;
  /** After "Go to a node" jumped to `node` (Admin makes it the selected node). */
  onReveal?: (node: CourseTreeNode) => void;
}) {
  const [query, setQuery] = useState("");
  const [hasCourses, setHasCourses] = useRememberedFlag(hasCoursesKey, hasCoursesDefault);
  const tree = useMemo(() => buildTree(data?.nodes ?? [], data?.courses ?? []), [data]);
  const view = useMemo(() => viewTree(tree.roots, { hasCourses, query }), [tree, hasCourses, query]);

  // Open by default: every branch with a course below it.
  const [expanded, setExpanded] = useState<Set<string> | null>(null);
  const open = useMemo(
    () => expanded ?? new Set([...tree.byId.values()].filter((n) => n.level < 4 && n.total + n.relatedTotal > 0).map((n) => n.id)),
    [expanded, tree],
  );
  // While searching, the matches' branches are open; clicks flip that per node.
  const [searchFlips, setSearchFlips] = useState<Set<string>>(new Set());
  useEffect(() => setSearchFlips(new Set()), [query]);
  const searching = query.trim().length > 0;
  const isOpen = (id: string) => (searching ? view.opened.has(id) !== searchFlips.has(id) : open.has(id));
  const toggle = (id: string) => {
    const flip = (prev: Set<string>) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    };
    if (searching) setSearchFlips(flip);
    else setExpanded(flip(open));
  };
  // Open the branch of the selected node (also a node just inserted, once it arrives) and,
  // for a first-child input, the node it goes under.
  useEffect(() => {
    const ids: string[] = [];
    for (let n = selectedId ? tree.byId.get(selectedId) : undefined; n; n = n.parentId ? tree.byId.get(n.parentId) : undefined) {
      if (n.id !== selectedId) ids.push(n.id);
    }
    if (draft?.insert === "child") ids.push(draft.nodeId);
    if (ids.length === 0) return;
    setExpanded((prev) => {
      const base = prev ?? open;
      if (ids.every((id) => base.has(id))) return prev;
      return new Set([...base, ...ids]);
    });
    // `open` is derived from `expanded`; listing it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, draft, tree]);
  // "Go to a node": "Has courses" is unticked so the whole tree shows, the node's branch opens,
  // and its row flashes briefly once in view.
  const [searchOpen, setSearchOpen] = useState(false);
  const [flashId, setFlashId] = useState<string | null>(null);
  function jumpTo(node: CourseTreeNode) {
    const ancestors: string[] = [];
    for (let n = node.parentId ? tree.byId.get(node.parentId) : undefined; n; n = n.parentId ? tree.byId.get(n.parentId) : undefined) {
      ancestors.push(n.id);
    }
    setQuery(""); // the filter field must not hide it
    setHasCourses(false);
    setExpanded((prev) => new Set([...(prev ?? open), ...ancestors]));
    setFlashId(node.id);
    onReveal?.(node);
  }
  useEffect(() => {
    if (!flashId) return;
    const frame = requestAnimationFrame(() => {
      document.querySelector(`[data-row-id="${flashId}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
      document.querySelector<HTMLElement>(`[data-node-id="${flashId}"]`)?.focus({ preventScroll: true });
    });
    const timer = setTimeout(() => setFlashId(null), 1800);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [flashId]);

  const branches = () => [...tree.byId.values()].filter((n) => n.level < 4 && view.visible.has(n.id)).map((n) => n.id);
  const expandAll = () =>
    searching ? setSearchFlips(new Set(branches().filter((id) => !view.opened.has(id)))) : setExpanded(new Set(branches()));
  const collapseAll = () => (searching ? setSearchFlips(new Set(branches().filter((id) => view.opened.has(id)))) : setExpanded(new Set()));

  const courses = data?.courses ?? [];
  const filed = courses.length - tree.unclassified.length;
  const q = query.trim().toLowerCase();
  const unclassified = q ? tree.unclassified.filter((c) => c.title.toLowerCase().includes(q)) : tree.unclassified;
  const visibleRoots = tree.roots.filter((r) => view.visible.has(r.id));
  const row = {
    view,
    flashId,
    isOpen,
    toggle,
    canClassify,
    renderCourseActions,
    selectedId,
    onSelect,
    draft,
    renderDraft,
    onNodeMenu,
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search topics or courses"
            aria-label="Search topics or courses"
            className="pl-8"
          />
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={hasCourses}
            onChange={(e) => setHasCourses(e.target.checked)}
            className="h-4 w-4 rounded border-border accent-[hsl(var(--primary))]"
          />
          Has courses
        </label>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 rounded-full"
            onClick={() => setSearchOpen(true)}
            disabled={!data}
            title="Go to a node: search the whole tree"
            aria-label="Go to a node"
          >
            <Navigation className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={expandAll}>
            <ChevronsUpDown className="h-3.5 w-3.5" aria-hidden="true" /> Expand all
          </Button>
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={collapseAll}>
            <ChevronsDownUp className="h-3.5 w-3.5" aria-hidden="true" /> Collapse all
          </Button>
          {toolbarExtra}
        </div>
      </div>

      {data && (
        <p className="mt-3 text-xs text-muted-foreground" role="status">
          {filed} of {plural(courses.length, "course")} filed in the tree
          {hasCourses ? " · branches without a course are hidden" : ""}
        </p>
      )}

      {isLoading || !data ? (
        error ? (
          <Card className="mt-4">
            <CardContent className="py-10 text-center text-sm text-destructive">{error.message}</CardContent>
          </Card>
        ) : (
          <div className="mt-4 h-64 animate-pulse rounded-lg bg-muted" />
        )
      ) : (
        <div className="mt-4 space-y-4">
          {unclassified.length > 0 && (
            <Card className="border-amber-500/40">
              <CardContent className="py-4">
                <h2 className="text-sm font-semibold">Not in the tree yet · {unclassified.length}</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {canClassify
                    ? "Choose a topic for these courses to file them under it."
                    : "An administrator files courses under their topic."}
                </p>
                <ul className="mt-2 divide-y divide-border/60">
                  {unclassified.map((c) => (
                    <CourseRow key={c.id} course={c} canClassify={canClassify} />
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="p-2 sm:p-3">
              {visibleRoots.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  {searching
                    ? `Nothing matches "${query.trim()}"${hasCourses ? " among the branches with courses" : ""}.`
                    : hasCourses
                      ? "No course is filed in the tree yet. Untick “Has courses” to browse the whole tree."
                      : "The tree is empty."}
                </p>
              ) : (
                <ul role="tree" aria-label="Course tree">
                  {visibleRoots.map((n) => (
                    <NodeRow key={n.id} node={n} depth={0} {...row} />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <NodeSearchDialog open={searchOpen} onOpenChange={setSearchOpen} roots={tree.roots} onPick={jumpTo} />
    </div>
  );
}

const NAME_CLASS: Record<number, string> = {
  1: "text-base font-semibold",
  2: "font-semibold",
  3: "font-medium",
  4: "",
};

interface RowProps {
  view: ReturnType<typeof viewTree>;
  /** The node "Go to a node" just jumped to, flashed briefly. */
  flashId: string | null;
  isOpen: (id: string) => boolean;
  toggle: (id: string) => void;
  canClassify: boolean;
  renderCourseActions?: (course: TaxonomyCourse) => React.ReactNode;
  selectedId?: string | null;
  onSelect?: (node: CourseTreeNode) => void;
  draft?: TreeDraft | null;
  renderDraft?: (level: number) => React.ReactNode;
  onNodeMenu?: (node: CourseTreeNode, at: { x: number; y: number }) => void;
}

/** The inline input row, indented like the node it will become. */
function DraftRow({ level, depth, renderDraft }: { level: number; depth: number; renderDraft?: (level: number) => React.ReactNode }) {
  return (
    <li role="none" className="py-1 pr-2" style={{ paddingLeft: 4 + depth * 20 + 28 }}>
      {renderDraft?.(level)}
    </li>
  );
}

function NodeRow({ node, depth, ...row }: RowProps & { node: CourseTreeNode; depth: number }) {
  const { view, flashId, isOpen, toggle, canClassify, renderCourseActions, selectedId, onSelect, draft, renderDraft, onNodeMenu } = row;
  // Under the element when opened from the keyboard (no pointer position).
  const menuAt = (el: Element) => {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.bottom };
  };
  const branch = node.level < 4;
  const childDraft = draft?.nodeId === node.id && draft.insert === "child";
  const neighbourDraft = draft?.nodeId === node.id && draft.insert === "neighbour";
  const expanded = branch && (isOpen(node.id) || childDraft);
  const children = node.children.filter((c) => view.visible.has(c.id));
  const selected = selectedId === node.id;
  return (
    <>
      <li role="treeitem" aria-expanded={branch ? expanded : undefined} aria-selected={selected}>
        <div
          className={cn(
            "group flex items-center gap-2 rounded-md py-1.5 pr-2 hover:bg-muted/40",
            view.matches.has(node.id) && "bg-primary/5",
            onSelect && "cursor-pointer",
            selected && "bg-primary/10 ring-1 ring-primary/40",
            flashId === node.id && "bg-amber-200/70 transition-colors duration-700 dark:bg-amber-500/30",
          )}
          data-row-id={node.id}
          style={{ paddingLeft: 4 + depth * 20 }}
          onClick={onSelect ? () => onSelect(node) : undefined}
          onContextMenu={
            onNodeMenu
              ? (e) => {
                  e.preventDefault();
                  const fromKeyboard = e.clientX === 0 && e.clientY === 0;
                  onNodeMenu(node, fromKeyboard ? menuAt(e.target as Element) : { x: e.clientX, y: e.clientY });
                }
              : undefined
          }
        >
          {branch ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggle(node.id);
              }}
              className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={`${expanded ? "Collapse" : "Expand"} ${node.name}`}
            >
              <ChevronRight className={cn("h-4 w-4 transition-transform", expanded && "rotate-90")} aria-hidden="true" />
            </button>
          ) : (
            <span className="w-5 shrink-0" aria-hidden="true" />
          )}
          <span className="w-14 shrink-0 font-mono text-[11px] text-muted-foreground">{node.code}</span>
          {onSelect ? (
            // The row selects on click; the name is its keyboard target.
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSelect(node);
              }}
              aria-pressed={selected}
              aria-haspopup={onNodeMenu ? "menu" : undefined}
              data-node-id={node.id}
              onKeyDown={(e) => {
                if (onNodeMenu && (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10"))) {
                  e.preventDefault();
                  e.stopPropagation();
                  onNodeMenu(node, menuAt(e.currentTarget));
                }
              }}
              className={cn("min-w-0 truncate text-left hover:text-primary", NAME_CLASS[node.level], selected && "text-primary")}
            >
              {node.name}
            </button>
          ) : branch ? (
            // Same action as the chevron (the keyboard target), for a bigger click area.
            <button
              type="button"
              tabIndex={-1}
              onClick={() => toggle(node.id)}
              className={cn("min-w-0 truncate text-left hover:text-primary", NAME_CLASS[node.level])}
            >
              {node.name}
            </button>
          ) : (
            <span className={cn("min-w-0 truncate", NAME_CLASS[node.level])}>{node.name}</span>
          )}
          <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">{LEVEL_LABELS[node.level as TaxonomyLevel]}</span>
          <span className="ml-auto flex shrink-0 items-center gap-1">
            {node.total > 0 && (
              <Badge variant="secondary" className="text-[10px]" title="Courses whose main topic is here (each counted once)">
                {plural(node.total, "course")}
              </Badge>
            )}
            {node.relatedTotal > 0 && (
              <Badge variant="outline" className="text-[10px]" title="Courses linked here as a related (connexe) topic, not counted above">
                +{node.relatedTotal} related
              </Badge>
            )}
          </span>
        </div>
        {!branch && node.courses.length + node.related.length > 0 && (
          <ul className="mb-1 border-l border-border/60" style={{ marginLeft: 30 + depth * 20 }}>
            {node.courses.map((c) => (
              <CourseRow key={c.id} course={c} canClassify={canClassify} extra={renderCourseActions?.(c)} />
            ))}
            {node.related.map((c) => (
              <CourseRow key={`related-${c.id}`} course={c} canClassify={false} related />
            ))}
          </ul>
        )}
        {expanded && (children.length > 0 || childDraft) && (
          <ul role="group">
            {childDraft && <DraftRow level={node.level + 1} depth={depth + 1} renderDraft={renderDraft} />}
            {children.map((c) => (
              <NodeRow key={c.id} node={c} depth={depth + 1} {...row} />
            ))}
          </ul>
        )}
      </li>
      {neighbourDraft && <DraftRow level={node.level} depth={depth} renderDraft={renderDraft} />}
    </>
  );
}

/** A course under a topic: its main placement, or (`related`) a related ("connexe") link, without actions. */
function CourseRow({
  course,
  canClassify,
  extra,
  related = false,
}: {
  course: TaxonomyCourse;
  canClassify: boolean;
  extra?: React.ReactNode;
  related?: boolean;
}) {
  const owner = course.owner;
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1 pl-3 text-sm">
      <Link href={`/study-sets/${course.id}`} className={cn("font-medium text-primary hover:underline", related && "font-normal")}>
        {course.title}
      </Link>
      {related && (
        <Badge variant="outline" className="text-[10px]" title="A related (connexe) topic of this course; its main topic is elsewhere">
          related
        </Badge>
      )}
      {owner && (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          {owner.nature === "BOT" ? (
            <Bot className="h-3 w-3" aria-label="Bot account" />
          ) : (
            <UserRound className="h-3 w-3" aria-label="Human account" />
          )}
          {owner.name || owner.email}
        </span>
      )}
      <span className="ml-auto flex items-center gap-1">
        {canClassify && (
          <ClassifyButton
            studySetId={course.id}
            title={course.title}
            topicId={course.topicId}
            label={course.topicId ? "Move" : "Choose topic"}
            className="h-7 text-xs"
          />
        )}
        {extra}
      </span>
    </li>
  );
}
