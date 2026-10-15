"use client";

import { Loader2, TriangleAlert } from "lucide-react";
import type { IndexingReadiness } from "@/hooks/use-api";

/**
 * Explains why generation is unavailable while sources are still being
 * imported (or one failed). Renders nothing once the set is fully indexed.
 */
export function IndexingNotice({ readiness }: { readiness: IndexingReadiness | undefined }) {
  if (!readiness || readiness.ready) return null;
  const importing = readiness.sources.processing > 0;
  return (
    <div
      role="status"
      className={
        importing
          ? "flex items-start gap-2 rounded-md border border-primary/40 bg-primary/5 p-3 text-sm"
          : "flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
      }
    >
      {importing ? (
        <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden="true" />
      ) : (
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
      )}
      <span>
        <span className="font-medium">Generation is paused.</span> {readiness.reason}
      </span>
    </div>
  );
}
