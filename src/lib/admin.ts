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

export type Role = "USER" | "ADMIN";
export type Nature = "HUMAN" | "BOT";

/**
 * Only a person can administer LearningForge: an account acts as ADMIN only
 * when its role is ADMIN *and* its nature is HUMAN. Bot accounts (tests, AI
 * agents) never get admin rights, even if a role was set directly in the
 * database.
 */
export function effectiveRole(role: Role, nature: Nature): Role {
  return role === "ADMIN" && nature === "HUMAN" ? "ADMIN" : "USER";
}

/** Why a role/nature combination is not allowed, or null when it is. */
export function adminRuleViolation(next: { role: Role; nature: Nature }, previous?: { role: Role; nature: Nature }): string | null {
  if (next.role !== "ADMIN" || next.nature === "HUMAN") return null;
  if (previous?.role === "ADMIN" && previous.nature === "HUMAN") {
    return "An Admin must be Human — remove the Admin role before changing the nature to Bot.";
  }
  return "Only Human accounts can be promoted to Admin — change the nature to Human first.";
}
