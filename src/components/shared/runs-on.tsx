import { Cloud, Cpu } from "lucide-react";
import { cn } from "@/lib/utils";

/** Where a local model runs on this computer. */
export type LocalHost = "Ollama" | "Speaches";

/**
 * The "Runs on" column of the admin model lists: "Local · Ollama",
 * "Local · Speaches" (local voices), or "Cloud · <provider>". Icon and text,
 * never colour alone.
 */
export function RunsOn({ cloud, local, className }: { cloud: string | null; local: LocalHost; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex w-40 shrink-0 items-center justify-end gap-1 text-right text-xs font-medium",
        cloud ? "text-sky-700 dark:text-sky-400" : "text-emerald-700 dark:text-emerald-400",
        className,
      )}
      title={cloud ? `Runs in the cloud at ${cloud}: text is sent to this provider` : `Runs on this computer (${local}): nothing leaves the server`}
    >
      {cloud ? <Cloud className="h-3.5 w-3.5" aria-hidden="true" /> : <Cpu className="h-3.5 w-3.5" aria-hidden="true" />}
      {cloud ? `Cloud · ${cloud}` : `Local · ${local}`}
    </span>
  );
}

/** Header of the "Runs on" column, above an option list. */
export function RunsOnHeader() {
  return (
    <div className="flex justify-end px-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground" aria-hidden="true">
      Runs on
    </div>
  );
}
