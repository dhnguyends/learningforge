"use client";

import { useRef, useState } from "react";
import { Link2, X } from "lucide-react";
import { toast } from "sonner";
import { DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { PointerMenu, type MenuPoint } from "@/components/shared/pointer-menu";
import { TopicPicker } from "@/components/shared/topic-picker";
import { useSetRelatedTopics, type Classification, type StudySetSummary } from "@/hooks/use-api";
import { cn } from "@/lib/utils";

/** Up to 3 related ("connexe") topics per course (the server enforces it too). */
export const MAX_RELATED = 3;

const fullPath = (c: Classification) => [c.discipline, c.subject, c.module, c.topic].map((l) => l.name).join(" › ");

/** "connexe : Topic 1 · Topic 2 · Topic 3" at the bottom of a course card (full path on hover). */
export function RelatedTopicsLine({ related, className }: { related: Classification[]; className?: string }) {
  if (related.length === 0) return null;
  return (
    <p className={cn("truncate text-xs text-muted-foreground", className)}>
      <span className="font-medium">connexe :</span>{" "}
      {related.map((r, i) => (
        <span key={r.topicId}>
          {i > 0 && " · "}
          <span title={fullPath(r)} className="text-foreground">
            {r.topic.name}
          </span>
        </span>
      ))}
    </p>
  );
}

/**
 * The course card's context menu: "Add related topic…" (topic picker; greyed
 * once 3 are set) and "Remove <topic>" for each related topic. Opened by a
 * right click on the card or Shift+F10 / the context-menu key on its title.
 */
export function RelatedTopicsMenu({
  target,
  onClose,
}: {
  target: { set: StudySetSummary; at: MenuPoint } | null;
  onClose: () => void;
}) {
  const setRelated = useSetRelatedTopics();
  const [picking, setPicking] = useState<StudySetSummary | null>(null);
  // Decided while the menu closes: open the picker, or return focus to the card's title.
  const next = useRef<{ pick: StudySetSummary | null; focusId: string | null }>({ pick: null, focusId: null });

  async function save(set: StudySetSummary, topicIds: string[], done: string) {
    try {
      await setRelated.mutateAsync({ studySetId: set.id, topicIds });
      toast.success(done);
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not change the related topics");
      return false;
    }
  }

  const set = target?.set;
  const full = (set?.related.length ?? 0) >= MAX_RELATED;
  const unavailable = new Map<string, string>();
  if (picking?.classification) unavailable.set(picking.classification.topicId, "main topic");
  for (const r of picking?.related ?? []) unavailable.set(r.topicId, "already related");

  return (
    <>
      <PointerMenu
        at={target?.at ?? null}
        onClose={() => {
          if (target && !next.current.pick) next.current.focusId = target.set.id;
          onClose();
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          const { pick, focusId } = next.current;
          next.current = { pick: null, focusId: null };
          // The picker opens only once the menu has closed (two Radix layers must not overlap).
          if (pick) setPicking(pick);
          else if (focusId) document.querySelector<HTMLElement>(`[data-set-link="${focusId}"]`)?.focus();
        }}
        className="w-72"
      >
        {set && (
          <>
            <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">{set.title}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <div title={full ? `A course has at most ${MAX_RELATED} related topics: remove one first` : undefined}>
              <DropdownMenuItem
                disabled={full}
                className="items-start gap-2"
                onSelect={() => {
                  next.current = { pick: set, focusId: null };
                }}
              >
                <Link2 className="mt-0.5 h-4 w-4" aria-hidden="true" />
                <span>
                  Add related topic…
                  <span className="block text-xs text-muted-foreground">
                    {full ? `${MAX_RELATED} of ${MAX_RELATED} already set` : `${set.related.length} of ${MAX_RELATED} set`}
                  </span>
                </span>
              </DropdownMenuItem>
            </div>
            {set.related.length > 0 && <DropdownMenuSeparator />}
            {set.related.map((r) => (
              <DropdownMenuItem
                key={r.topicId}
                className="gap-2"
                title={fullPath(r)}
                onSelect={() => {
                  next.current = { pick: null, focusId: set.id };
                  void save(
                    set,
                    set.related.filter((x) => x.topicId !== r.topicId).map((x) => x.topicId),
                    `"${r.topic.name}" is no longer related to "${set.title}"`,
                  );
                }}
              >
                <X className="h-4 w-4" aria-hidden="true" />
                <span className="truncate">Remove {r.topic.name}</span>
              </DropdownMenuItem>
            ))}
          </>
        )}
      </PointerMenu>

      <TopicPicker
        open={picking !== null}
        onOpenChange={(open) => {
          if (open) return;
          const id = picking?.id;
          setPicking(null);
          if (id) requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-set-link="${id}"]`)?.focus());
        }}
        title="Add a related topic"
        description={
          <>
            Link &ldquo;{picking?.title}&rdquo; to a related (connexe) topic, besides its main one. Up to {MAX_RELATED}.
          </>
        }
        unavailable={unavailable}
        pending={setRelated.isPending}
        onChoose={(topic) => {
          if (!picking) return;
          const course = picking;
          void save(course, [...course.related.map((r) => r.topicId), topic.id], `"${topic.name}" is now related to "${course.title}"`).then(
            (ok) => ok && setPicking(null),
          );
        }}
      />
    </>
  );
}
