import { z } from "zod";

/**
 * Phase 4, PolyLingue for Schools: pure rules for classes (assignment status,
 * students falling behind, CSV export, suggested in-class activities). The
 * services in classes-service.ts load and store.
 */

export type AssignmentState = "done" | "late" | "todo" | "overdue";

/**
 * A student's state on an assignment: every assigned lesson completed (on
 * time, or after the due date), or not yet (before or after the due date).
 */
export function assignmentState(
  lessonIds: string[],
  completedAt: Map<string, Date>,
  dueAt: Date,
  now: Date,
): { state: AssignmentState; done: number; total: number; finishedAt: Date | null } {
  const dates = lessonIds.map((id) => completedAt.get(id)).filter((d): d is Date => Boolean(d));
  const total = lessonIds.length;
  if (total > 0 && dates.length === total) {
    const finishedAt = new Date(Math.max(...dates.map((d) => d.getTime())));
    return { state: finishedAt.getTime() <= dueAt.getTime() ? "done" : "late", done: total, total, finishedAt };
  }
  return { state: now.getTime() > dueAt.getTime() ? "overdue" : "todo", done: dates.length, total, finishedAt: null };
}

export interface BehindInput {
  /** Days since the student last practised (null: never). */
  inactiveDays: number | null;
  /** Minutes practised in the last 7 days. */
  minutes7: number;
  weeklyMinutes: number;
  overdue: number;
}

/** Why a student is falling behind (empty: on track): inactive 3+ days, below the weekly target, or overdue work. */
export function behindReasons(s: BehindInput): string[] {
  const out: string[] = [];
  if (s.inactiveDays === null) out.push("Has not practised yet");
  else if (s.inactiveDays >= 3) out.push(`Inactive for ${s.inactiveDays} days`);
  if (s.minutes7 < s.weeklyMinutes) out.push(`${s.minutes7} of ${s.weeklyMinutes} min this week`);
  if (s.overdue > 0) out.push(`${s.overdue} overdue assignment${s.overdue > 1 ? "s" : ""}`);
  return out;
}

/** CSV with a header row; fields quoted when needed, formulas neutralised for spreadsheets. */
export function toCsv(header: string[], rows: (string | number | null)[][]): string {
  const cell = (v: string | number | null) => {
    if (v === null || v === undefined) return "";
    let s = String(v);
    // A leading = + - @ would run as a formula in Excel / LibreOffice.
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

export const ACTIVITY_KINDS = ["role-play", "speaking", "grammar", "vocabulary", "game", "listening", "writing"] as const;

export const activitiesSchema = z.object({
  activities: z
    .array(
      z.object({
        title: z.string().min(1).max(120),
        kind: z.enum(ACTIVITY_KINDS),
        minutes: z.number().int().min(5).max(60),
        /** What the difficulty is, in a few words (a grammar point, words…). */
        targets: z.string().max(200),
        instructions: z.string().min(1).max(1200),
      }),
    )
    .min(2)
    .max(6),
});
export type ClassActivities = z.infer<typeof activitiesSchema>;

export function mockActivities(words: string[], grammar: string[]): ClassActivities {
  return {
    activities: [
      {
        title: "Word relay",
        kind: "vocabulary",
        minutes: 10,
        targets: words.slice(0, 5).join(", ") || "the unit's words",
        instructions: "In pairs, students take turns using each word in a sentence; the partner checks it.",
      },
      {
        title: "Grammar spotlight",
        kind: "grammar",
        minutes: 15,
        targets: grammar[0] ?? "the unit's grammar",
        instructions: "Show three example sentences, ask students to find the rule, then write two sentences of their own.",
      },
      {
        title: "Café role-play",
        kind: "role-play",
        minutes: 15,
        targets: "speaking with the week's words",
        instructions: "One student orders, the other serves; swap roles after five minutes.",
      },
    ],
  };
}
