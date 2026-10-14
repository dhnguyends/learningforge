"use client";

import { Quote, Play, FileText } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/misc";
import { formatTimestamp } from "@/lib/utils";

export interface AnchorData {
  id: string;
  sourceId: string;
  sourceTitle: string;
  sourceType: string;
  startMs?: number | null;
  endMs?: number | null;
  page?: number | null;
  excerpt: string;
}

/**
 * A citation: timestamp/page label + source title, tooltip with the verbatim
 * excerpt for verification, click → open the source at that moment/page.
 */
export function CitationChip({
  anchor,
  studySetId,
  size = "default",
}: {
  anchor: AnchorData;
  studySetId: string;
  size?: "default" | "sm";
}) {
  const isTime = anchor.startMs != null;
  const label = isTime
    ? `${formatTimestamp(anchor.startMs!)}${anchor.endMs != null ? `–${formatTimestamp(anchor.endMs)}` : ""}`
    : anchor.page != null
      ? `p. ${anchor.page}`
      : "source";

  const href = `/study-sets/${studySetId}/sources?source=${anchor.sourceId}${
    isTime ? `&t=${Math.max(0, Math.floor((anchor.startMs ?? 0) / 1000))}` : anchor.page != null ? `&page=${anchor.page}` : ""
  }`;

  return (
    <TooltipProvider delayDuration={120}>
      <Tooltip>
        <TooltipTrigger asChild>
          <a
            href={href}
            onClick={(e) => {
              // Let the router handle it (keeps workspace state); default nav is fine too.
              e.currentTarget.blur();
            }}
            className={`inline-flex max-w-full items-center gap-1.5 rounded-full bg-citation/15 px-2.5 py-0.5 font-mono text-xs text-[hsl(var(--citation))] ring-1 ring-inset ring-[hsl(var(--citation)/0.45)] transition-colors hover:bg-citation/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              size === "sm" ? "text-[11px]" : ""
            }`}
            aria-label={`Citation: ${anchor.sourceTitle}, ${isTime ? `timestamp ${label}` : `page ${anchor.page}`}. Shows the cited excerpt.`}
          >
            {isTime ? <Play className="h-3 w-3 shrink-0" aria-hidden="true" /> : <FileText className="h-3 w-3 shrink-0" aria-hidden="true" />}
            <span className="shrink-0">{label}</span>
            <span className="max-w-[16ch] truncate font-sans opacity-80">{anchor.sourceTitle}</span>
          </a>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-sm">
          <p className="mb-1 flex items-center gap-1 font-medium">
            <Quote className="h-3 w-3" aria-hidden="true" /> {anchor.sourceTitle}
          </p>
          <p className="opacity-90">{anchor.excerpt}</p>
          <p className="mt-1 text-[10px] opacity-70">Click to open the source at this location</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function CitationList({
  anchors,
  studySetId,
  size = "sm",
  max = 3,
}: {
  anchors: AnchorData[];
  studySetId: string;
  size?: "default" | "sm";
  max?: number;
}) {
  if (anchors.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Source citations">
      {anchors.slice(0, max).map((anchor) => (
        <CitationChip key={anchor.id} anchor={anchor} studySetId={studySetId} size={size} />
      ))}
      {anchors.length > max && (
        <span className="text-xs text-muted-foreground">+{anchors.length - max} more</span>
      )}
    </div>
  );
}
