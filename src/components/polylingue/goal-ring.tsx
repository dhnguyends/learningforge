import { Flame } from "lucide-react";
import { cn } from "@/lib/utils";

/** Daily goal ring: minutes practised today out of the goal. */
export function GoalRing({ minutes, goal, size = 56, className }: { minutes: number; goal: number; size?: number; className?: string }) {
  const pct = Math.min(1, goal > 0 ? minutes / goal : 0);
  const r = size / 2 - 5;
  const c = 2 * Math.PI * r;
  const done = pct >= 1;
  return (
    <div className={cn("relative inline-flex shrink-0", className)} style={{ width: size, height: size }} title={`${Math.floor(minutes)} of ${goal} minutes today`}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={6} className="stroke-muted" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={6}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          className={cn("transition-all duration-500", done ? "stroke-emerald-500" : "stroke-primary")}
        />
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center text-center leading-none">
        <span className="text-sm font-semibold tabular-nums">{Math.floor(minutes)}</span>
        <span className="text-[9px] text-muted-foreground">/ {goal} min</span>
      </span>
      <span className="sr-only">{`${Math.floor(minutes)} of ${goal} minutes today${done ? ", goal reached" : ""}`}</span>
    </div>
  );
}

/** Streak counter with a flame (grey when the streak is 0). */
export function StreakBadge({ streak, className }: { streak: number; className?: string }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-sm font-semibold tabular-nums", streak > 0 ? "bg-orange-500/10 text-orange-600 dark:text-orange-400" : "bg-muted text-muted-foreground", className)}
      title={`${streak}-day streak`}
    >
      <Flame className="h-4 w-4" aria-hidden="true" /> {streak}
      <span className="sr-only"> day streak</span>
    </span>
  );
}
