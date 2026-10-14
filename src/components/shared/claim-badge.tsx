"use client";

import { BadgeCheck, Sparkles, BookOpen, HelpCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export type ClaimType = "SOURCE_GROUNDED" | "INFERENCE" | "EXTERNAL" | "source_grounded" | "inference" | "external";

const CONFIG: Record<string, { label: string; icon: React.ReactNode; className: string }> = {
  SOURCE_GROUNDED: {
    label: "Supported by source",
    icon: <BadgeCheck className="h-3 w-3" aria-hidden="true" />,
    className: "bg-[hsl(var(--success))]/15 text-[hsl(var(--success))] ring-[hsl(var(--success))]/40",
  },
  INFERENCE: {
    label: "Inference / synthesis",
    icon: <Sparkles className="h-3 w-3" aria-hidden="true" />,
    className: "bg-[hsl(var(--warning))]/15 text-[hsl(var(--warning))] ring-[hsl(var(--warning))]/40",
  },
  EXTERNAL: {
    label: "Additional practice, not in source",
    icon: <BookOpen className="h-3 w-3" aria-hidden="true" />,
    className: "bg-muted text-muted-foreground ring-muted-foreground/30",
  },
};

/** Claim provenance label — icon + text, never color alone (a11y). */
export function ClaimBadge({ type, compact = false }: { type: ClaimType; compact?: boolean }) {
  const config = CONFIG[type];
  if (!config) {
    return (
      <Badge variant="muted">
        <HelpCircle className="h-3 w-3" aria-hidden="true" />
        Unknown provenance
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className={`gap-1 ${config.className}`} title={`Provenance: ${config.label}`}>
      {config.icon}
      {compact ? config.label.split(" ")[0] : config.label}
    </Badge>
  );
}
