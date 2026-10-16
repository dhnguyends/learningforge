"use client";

import { useMemo, useRef, useState } from "react";
import { Check, Download, IndentIncrease, ListPlus, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { PointerMenu } from "@/components/shared/pointer-menu";
import { CourseTreeView, type CourseTreeNode, type TreeDraft } from "@/components/shared/course-tree";
import { useClassifyStudySet, useInsertTaxonomyNode, useTaxonomy, type TaxonomyCourse } from "@/hooks/use-api";
import { LEVEL_LABELS, type TaxonomyLevel } from "@/lib/taxonomy/parse";

const levelName = (level: number) => LEVEL_LABELS[level as TaxonomyLevel];
const NO_CHILDREN = "Topics are the lowest level: a topic has no children";
const errorText = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

/**
 * Admin → Courses Tree: the whole tree with every course, maintained by
 * selecting a node and pressing one of two icons (or right-clicking it, or
 * Shift+F10 / the context-menu key on it, for the same two actions in a menu):
 *  - Insert child: a new FIRST child, one level down (not under a topic, the leaf);
 *  - Insert neighbour: a new node right AFTER the selected one, same parent and level.
 * An input row appears in place; Enter adds, Esc cancels. Nothing is ever
 * created above an existing node, and a name already used anywhere in the
 * tree is refused. Courses are filed / moved / removed from the rows too.
 * The database is the source of truth; "Download .txt" (or
 * `npm run taxonomy:export`) writes it in the docs/COURSE-TAXONOMY.txt format.
 */
export function AdminCourseTree() {
  const { data, isLoading, error } = useTaxonomy("all");
  const insert = useInsertTaxonomyNode();
  const classify = useClassifyStudySet();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TreeDraft | null>(null);
  const [name, setName] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);
  // The node's context menu, opened at viewport position x, y.
  const [menu, setMenu] = useState<{ node: CourseTreeNode; x: number; y: number } | null>(null);
  // The node the menu was opened on, still known when focus returns after it closed.
  const menuNodeId = useRef<string | null>(null);

  const byId = useMemo(() => new Map((data?.nodes ?? []).map((n) => [n.id, n])), [data]);
  const selected = selectedId ? byId.get(selectedId) : undefined;
  const emptyTree = data !== undefined && data.nodes.length === 0;
  const canInsertChild = selected !== undefined && selected.level < 4;
  const canInsertNeighbour = selected !== undefined || emptyTree;

  /** Opens the inline input for the selected node (or `node`, which becomes selected). */
  function start(mode: TreeDraft["insert"], node?: { id: string; level: number }) {
    const anchor = node ?? selected;
    if (mode === "child" && anchor && anchor.level >= 4) return; // a topic has no children
    menuNodeId.current = null; // the new input takes the focus, not the node
    setName("");
    setDraftError(null);
    if (anchor) setSelectedId(anchor.id);
    // An empty tree has nothing to select: its first discipline is a "neighbour" of nothing.
    setDraft({ nodeId: anchor?.id ?? "", insert: mode });
  }

  function cancel() {
    setDraft(null);
    setDraftError(null);
  }

  async function submit() {
    if (!draft || !name.trim() || insert.isPending) return;
    try {
      const { node } = await insert.mutateAsync({ nodeId: draft.nodeId || null, insert: draft.insert, name });
      toast.success(`${levelName(node.level)} ${node.code} "${node.name}" added`);
      setDraft(null);
      setSelectedId(node.id);
    } catch (err) {
      setDraftError(errorText(err, "Could not add it"));
    }
  }

  async function unassign(course: TaxonomyCourse) {
    try {
      await classify.mutateAsync({ studySetId: course.id, topicId: null });
      toast.success(`"${course.title}" removed from its topic`);
    } catch (err) {
      toast.error(errorText(err, "Could not remove the topic"));
    }
  }

  const draftInput = (level: number) => (
    <div>
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <span className="shrink-0 text-[11px] text-muted-foreground">New {levelName(level).toLowerCase()}</span>
        <Input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setDraftError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") cancel();
          }}
          placeholder="Name — Enter to add, Esc to cancel"
          aria-label={`Name of the new ${levelName(level).toLowerCase()}`}
          aria-invalid={draftError !== null}
          maxLength={120}
          autoFocus
          data-draft-input
          className="h-8 max-w-sm"
        />
        <Button type="submit" size="icon" className="h-8 w-8" disabled={!name.trim() || insert.isPending} aria-label="Add">
          {insert.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Check className="h-4 w-4" aria-hidden="true" />
          )}
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          onClick={cancel}
          disabled={insert.isPending}
          aria-label="Cancel"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </form>
      {draftError && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {draftError}
        </p>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">Courses Tree</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Discipline › Subject › Course / Module › Topic, with every course filed in it. Select a node, then insert its first child or its
          next neighbour. Every name is unique in the whole tree. Changes are saved at once and audited; the download writes the tree in the{" "}
          <code className="text-xs">docs/COURSE-TAXONOMY.txt</code> format.
        </p>
      </div>

      <div
        className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2"
        role="toolbar"
        aria-label="Maintain the tree"
      >
        {/* The tooltip sits on a wrapper: a disabled button shows none. */}
        <span
          title={
            !selected ? "Select a node first" : selected.level >= 4 ? NO_CHILDREN : "Insert child: a new first child of the selected node"
          }
        >
          <Button
            size="icon"
            variant="outline"
            className="h-8 w-8"
            onClick={() => start("child")}
            disabled={!canInsertChild || draft !== null}
            aria-label="Insert child"
            aria-describedby={selected && selected.level >= 4 ? "insert-child-why" : undefined}
          >
            <IndentIncrease className="h-4 w-4" aria-hidden="true" />
          </Button>
        </span>
        <span
          title={
            canInsertNeighbour ? "Insert neighbour: a new node right after the selected one, at the same level" : "Select a node first"
          }
        >
          <Button
            size="icon"
            variant="outline"
            className="h-8 w-8"
            onClick={() => start("neighbour")}
            disabled={!canInsertNeighbour || draft !== null}
            aria-label="Insert neighbour"
          >
            <ListPlus className="h-4 w-4" aria-hidden="true" />
          </Button>
        </span>
        <span className="text-sm text-muted-foreground" role="status">
          {selected ? (
            <>
              Selected: <span className="font-mono text-xs">{selected.code}</span>{" "}
              <span className="font-medium text-foreground">{selected.name}</span>{" "}
              <span className="text-xs">({levelName(selected.level)})</span>
              {selected.level >= 4 && (
                <span id="insert-child-why" className="ml-2 text-xs">
                  · {NO_CHILDREN}
                </span>
              )}
            </>
          ) : emptyTree ? (
            "The tree is empty: insert its first discipline."
          ) : (
            "Select a node in the tree."
          )}
        </span>
      </div>

      {emptyTree && draft && <div className="pl-2">{draftInput(1)}</div>}

      <CourseTreeView
        data={data}
        isLoading={isLoading}
        error={error}
        canClassify
        hasCoursesKey="lf.admin-tree.hasCourses"
        hasCoursesDefault={false}
        toolbarExtra={
          <Button asChild size="sm" variant="outline" className="gap-1.5">
            <a href="/api/admin/taxonomy/export" download="COURSE-TAXONOMY.txt">
              <Download className="h-3.5 w-3.5" aria-hidden="true" /> Download .txt
            </a>
          </Button>
        }
        selectedId={selectedId}
        onSelect={(node: CourseTreeNode) => {
          if (draft) return; // finish or cancel the input first
          setSelectedId(node.id === selectedId ? null : node.id);
        }}
        draft={draft}
        renderDraft={draftInput}
        onReveal={(node) => {
          // "Go to a node": it becomes the selected node (unless an input is open).
          if (!draft) setSelectedId(node.id);
        }}
        onNodeMenu={(node, at) => {
          if (draft) return; // finish or cancel the input first
          setSelectedId(node.id);
          menuNodeId.current = node.id;
          setMenu({ node, ...at });
        }}
        renderCourseActions={(course) => (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs text-muted-foreground hover:text-destructive"
            onClick={() => void unassign(course)}
            disabled={classify.isPending}
            aria-label={`Remove ${course.title} from its topic`}
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" /> Remove
          </Button>
        )}
      />

      <PointerMenu
        at={menu}
        onClose={() => setMenu(null)}
        onCloseAutoFocus={(e) => {
          // Back to the node's name (Esc, outside click); an action focuses its input instead.
          e.preventDefault();
          if (menuNodeId.current) document.querySelector<HTMLElement>(`[data-node-id="${menuNodeId.current}"]`)?.focus();
          // After an action: the input mounted while the menu still held the focus.
          else requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-draft-input]")?.focus());
        }}
      >
        {menu && (
          <>
            <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">
              {menu.node.code} {menu.node.name}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <div title={menu.node.level >= 4 ? NO_CHILDREN : undefined}>
              <DropdownMenuItem disabled={menu.node.level >= 4} className="items-start gap-2" onSelect={() => start("child", menu.node)}>
                <IndentIncrease className="mt-0.5 h-4 w-4" aria-hidden="true" />
                <span>
                  Insert child
                  <span className="block text-xs text-muted-foreground">
                    {menu.node.level >= 4 ? "Topics have no children" : `New first ${levelName(menu.node.level + 1).toLowerCase()}`}
                  </span>
                </span>
              </DropdownMenuItem>
            </div>
            <DropdownMenuItem className="items-start gap-2" onSelect={() => start("neighbour", menu.node)}>
              <ListPlus className="mt-0.5 h-4 w-4" aria-hidden="true" />
              <span>
                Insert neighbour
                <span className="block text-xs text-muted-foreground">New {levelName(menu.node.level).toLowerCase()} right after it</span>
              </span>
            </DropdownMenuItem>
          </>
        )}
      </PointerMenu>
    </div>
  );
}
