/** Fields an administrator sees for each account (never the password hash). */
export const ADMIN_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { studySets: true } },
} as const;
