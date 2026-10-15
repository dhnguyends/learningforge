"use client";

import { Loader2, RotateCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useDeleteSource, useReprocessSource } from "@/hooks/use-api";
import { useConfirm, type ConfirmOptions } from "@/components/shared/confirm-dialog";

/** Source statuses during which an import is already under way. */
export const IMPORTING_STATUSES = ["UPLOADED", "PROCESSING"];

export function deleteSourcePrompt(title: string): ConfirmOptions {
  return {
    title: "Delete this source?",
    description: `"${title}" is deleted permanently, with its stored file and everything derived from it (citations, cards, questions).`,
    confirmLabel: "Delete permanently",
    destructive: true,
  };
}

export function reprocessSourcePrompt(title: string): ConfirmOptions {
  return {
    title: "Import this source again?",
    description:
      `"${title}" is re-transcribed or re-parsed and re-indexed. Generation pauses until it is ready, and citations ` +
      "to its old passages lose their link — regenerate the study material afterwards.",
    confirmLabel: "Import again",
  };
}

/**
 * Per-source "Import again" and "Delete" buttons for a row of the sources
 * list. "Import again" is disabled while the source is already being imported.
 */
export function SourceRowActions({
  studySetId,
  source,
}: {
  studySetId: string;
  source: { id: string; title: string; status: string };
}) {
  const reprocess = useReprocessSource(studySetId);
  const remove = useDeleteSource(studySetId);
  const confirm = useConfirm();
  const importing = IMPORTING_STATUSES.includes(source.status);

  async function onReprocess() {
    if (!(await confirm(reprocessSourcePrompt(source.title)))) return;
    try {
      await reprocess.mutateAsync(source.id);
      toast.success(`Importing "${source.title}" again`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start the import");
    }
  }

  async function onDelete() {
    if (!(await confirm(deleteSourcePrompt(source.title)))) return;
    try {
      await remove.mutateAsync(source.id);
      toast.success("Source deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  }

  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={() => void onReprocess()}
        disabled={importing || reprocess.isPending || remove.isPending}
        title={importing ? "Already importing" : "Import again"}
        aria-label={`Import ${source.title} again`}
      >
        {reprocess.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RotateCw className="h-4 w-4" aria-hidden="true" />}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-destructive hover:text-destructive"
        onClick={() => void onDelete()}
        disabled={remove.isPending}
        title="Delete permanently"
        aria-label={`Delete ${source.title}`}
      >
        {remove.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
      </Button>
    </div>
  );
}
