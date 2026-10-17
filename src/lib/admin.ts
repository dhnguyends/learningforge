/** Fields an administrator sees for each account (never the password hash). */
export const ADMIN_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  nature: true,
  lastActiveAt: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { studySets: true } },
} as const;

export type Role = "USER" | "TEACHER" | "ADMIN";
export type Nature = "HUMAN" | "BOT";

/**
 * Only a person can administer LearningForge or teach a class: an account
 * acts as ADMIN or TEACHER only when its nature is HUMAN. Bot accounts (tests,
 * AI agents) never get those rights, even if a role was set directly in the
 * database.
 */
export function effectiveRole(role: Role, nature: Nature): Role {
  if (nature !== "HUMAN") return "USER";
  return role === "ADMIN" || role === "TEACHER" ? role : "USER";
}

/** Can run PolyLingue classes: teachers, and administrators. */
export function canTeach(role: Role | undefined | null): boolean {
  return role === "TEACHER" || role === "ADMIN";
}

const ROLE_NAME: Record<Role, string> = { USER: "User", TEACHER: "Teacher", ADMIN: "Admin" };

/** Why a role/nature combination is not allowed, or null when it is. */
export function adminRuleViolation(next: { role: Role; nature: Nature }, previous?: { role: Role; nature: Nature }): string | null {
  if (next.role === "USER" || next.nature === "HUMAN") return null;
  if (previous && previous.role === next.role && previous.nature === "HUMAN") {
    return `${a(ROLE_NAME[next.role])} must be Human — remove the ${ROLE_NAME[next.role]} role before changing the nature to Bot.`;
  }
  return `Only Human accounts can be ${next.role === "ADMIN" ? "promoted to Admin" : "made Teachers"} — change the nature to Human first.`;
}

const a = (word: string) => (/^[AEIOU]/.test(word) ? `An ${word}` : `A ${word}`);
