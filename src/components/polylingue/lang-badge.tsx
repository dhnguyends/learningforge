import { cn } from "@/lib/utils";

const COLORS: Record<string, string> = {
  es: "bg-red-500/15 text-red-700 dark:text-red-300",
  en: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  fr: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
  de: "bg-amber-500/20 text-amber-800 dark:text-amber-300",
  it: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  pt: "bg-green-600/15 text-green-800 dark:text-green-300",
};

/** Language code badge ("ES", "EN"…): flag emojis do not render on Windows. */
export function LangBadge({ code, size = "md", className }: { code: string; size?: "sm" | "md" | "lg"; className?: string }) {
  const box = size === "lg" ? "h-14 w-14 text-xl" : size === "sm" ? "h-6 w-6 text-[10px]" : "h-10 w-10 text-sm";
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center rounded-xl font-bold tracking-wide", box, COLORS[code] ?? "bg-muted text-foreground", className)}
      aria-hidden="true"
    >
      {code.toUpperCase()}
    </span>
  );
}
