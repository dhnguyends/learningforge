import { cn } from "@/lib/utils";
import { Hammer } from "lucide-react";

/** LectureForge mark: an anvil struck by a spark — study material forged from raw lectures. */
export function Logo({ className, size = 24 }: { className?: string; size?: number }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)} aria-hidden="true">
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
        <rect x="0.75" y="0.75" width="30.5" height="30.5" rx="7" className="fill-primary/10 stroke-primary" strokeWidth="1.5" />
        <path d="M8 11h12.5a3.5 3.5 0 0 1 3.5 3.5V16H8v-5Z" className="fill-primary" />
        <path d="M13 16h5l-1.2 6.5a1.5 1.5 0 0 1-1.48 1.25h-.64A1.5 1.5 0 0 1 14.2 22.5L13 16Z" className="fill-primary/70" />
        <path d="M24.5 8.5 27 11l-4 4-2.5-2.5 4-4Z" className="fill-[hsl(var(--citation))]" />
      </svg>
    </span>
  );
}

export function LogoWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <Logo size={26} />
      <span className="text-lg font-semibold tracking-tight">
        Lecture<span className="text-primary">Forge</span>
      </span>
    </span>
  );
}

export function BrandIcon() {
  return <Hammer className="h-4 w-4" aria-hidden="true" />;
}
