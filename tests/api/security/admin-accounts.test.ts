import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { NextRequest } from "next/server";
import "../helpers";
import { prisma, createTestUser, disposeTestUser, signInAs, jsonRequest, type TestUser } from "../helpers";
import { GET as listUsers, POST as createUser } from "@/app/api/admin/users/route";
import { PATCH as updateUser, DELETE as deleteUser } from "@/app/api/admin/users/[userId]/route";
import { POST as register } from "@/app/api/auth/register/route";
import { POST as unlock } from "@/app/api/access/route";
import { GET as listStudySets } from "@/app/api/study-sets/route";
import { ACCESS_COOKIE } from "@/lib/access-gate";

/**
 * Invite-only accounts: self-registration is closed, only ADMINs manage
 * accounts (role checked in the database), the last admin cannot be removed,
 * and a deleted account's session stops working immediately.
 */
const BASE = "http://localhost";
let admin: TestUser;
let user: TestUser;
const created: string[] = [];

beforeAll(async () => {
  admin = await createTestUser("Admin");
  await prisma.user.update({ where: { id: admin.id }, data: { role: "ADMIN" } });
  user = await createTestUser("Plain user");
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { in: created } } });
  await disposeTestUser(admin.email);
  await disposeTestUser(user.email);
  await prisma.$disconnect();
});

const newEmail = () => {
  const email = `admin-made-${crypto.randomUUID()}@test.lectureforge`;
  created.push(email);
  return email;
};
const ctx = (userId: string) => ({ params: { userId } });

describe("authorization", () => {
  it("rejects anonymous and non-admin callers", async () => {
    signInAs(null);
    expect((await listUsers(jsonRequest(`${BASE}/api/admin/users`, "GET"), {} as never)).status).toBe(401);
    signInAs(user.id);
    expect((await listUsers(jsonRequest(`${BASE}/api/admin/users`, "GET"), {} as never)).status).toBe(403);
    const res = await createUser(jsonRequest(`${BASE}/api/admin/users`, "POST", { name: "x", email: newEmail(), password: "long-enough-pw" }), {} as never);
    expect(res.status).toBe(403);
  });

  it("re-checks the role in the database, not the session token", async () => {
    // A session token minted while the user was admin must not survive a demotion.
    await prisma.user.update({ where: { id: user.id }, data: { role: "USER" } });
    signInAs(user.id); // mocked session carries no role; the DB says USER
    expect((await listUsers(jsonRequest(`${BASE}/api/admin/users`, "GET"), {} as never)).status).toBe(403);
  });
});

describe("account management", () => {
  it("creates, lists, edits and deletes an account — never exposing password hashes", async () => {
    signInAs(admin.id);
    const email = newEmail();
    const res = await createUser(jsonRequest(`${BASE}/api/admin/users`, "POST", { name: "New Person", email, password: "first-password-1" }), {} as never);
    expect(res.status).toBe(201);
    const { user: made } = (await res.json()) as { user: { id: string; role: string; passwordHash?: string } };
    expect(made.role).toBe("USER");
    expect(made.passwordHash).toBeUndefined();
    expect(await prisma.workspaceMember.count({ where: { userId: made.id, role: "OWNER" } })).toBe(1);

    const list = (await (await listUsers(jsonRequest(`${BASE}/api/admin/users`, "GET"), {} as never)).json()) as { users: Array<Record<string, unknown>> };
    expect(list.users.some((u) => u.email === email)).toBe(true);
    expect(list.users.every((u) => !("passwordHash" in u))).toBe(true);

    const before = (await prisma.user.findUniqueOrThrow({ where: { id: made.id } })).passwordHash;
    const upd = await updateUser(jsonRequest(`${BASE}/api/admin/users/${made.id}`, "PATCH", { name: "Renamed", password: "second-password-2", role: "ADMIN" }), ctx(made.id));
    expect(upd.status).toBe(200);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: made.id } });
    expect(after).toMatchObject({ name: "Renamed", role: "ADMIN" });
    expect(after.passwordHash).not.toBe(before);

    const del = await deleteUser(jsonRequest(`${BASE}/api/admin/users/${made.id}`, "DELETE"), ctx(made.id));
    expect(del.status).toBe(200);
    expect(await prisma.user.findUnique({ where: { id: made.id } })).toBeNull();
  });

  it("rejects duplicate emails and short passwords", async () => {
    signInAs(admin.id);
    const dup = await createUser(jsonRequest(`${BASE}/api/admin/users`, "POST", { name: "Dup", email: user.email, password: "long-enough-pw" }), {} as never);
    expect(dup.status).toBe(400);
    const short = await createUser(jsonRequest(`${BASE}/api/admin/users`, "POST", { name: "Short", email: newEmail(), password: "short" }), {} as never);
    expect(short.status).toBe(400);
  });

  it("protects the last administrator and the caller's own account", async () => {
    signInAs(admin.id);
    const others = await prisma.user.findMany({ where: { role: "ADMIN", NOT: { id: admin.id } }, select: { id: true } });
    await prisma.user.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { role: "USER" } });
    try {
      const demote = await updateUser(jsonRequest(`${BASE}/api/admin/users/${admin.id}`, "PATCH", { role: "USER" }), ctx(admin.id));
      expect(demote.status).toBe(400);
      expect(((await demote.json()) as { error: string }).error).toMatch(/last administrator/);
      const self = await deleteUser(jsonRequest(`${BASE}/api/admin/users/${admin.id}`, "DELETE"), ctx(admin.id));
      expect(self.status).toBe(400);
    } finally {
      await prisma.user.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { role: "ADMIN" } });
    }
  });

  it("a deleted account's existing session stops working immediately", async () => {
    const victim = await createTestUser("Soon deleted");
    signInAs(victim.id);
    expect((await listStudySets(jsonRequest(`${BASE}/api/study-sets`, "GET"), {} as never)).status).toBe(200);
    signInAs(admin.id);
    expect((await deleteUser(jsonRequest(`${BASE}/api/admin/users/${victim.id}`, "DELETE"), ctx(victim.id))).status).toBe(200);
    signInAs(victim.id); // the JWT would still be valid
    expect((await listStudySets(jsonRequest(`${BASE}/api/study-sets`, "GET"), {} as never)).status).toBe(401);
  });
});

describe("self-registration", () => {
  it("is closed", async () => {
    const res = await register();
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "registration_disabled" });
  });
});

describe("POST /api/access", () => {
  const prev = process.env.LECTURE_ACCESS_KEY;
  afterEach(() => {
    process.env.LECTURE_ACCESS_KEY = prev;
  });
  const post = (key: string, ip: string) =>
    new NextRequest(`${BASE}/api/access`, {
      method: "POST",
      body: JSON.stringify({ key }),
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
    });

  it("issues the cookie only for the right key, and throttles guessing", async () => {
    process.env.LECTURE_ACCESS_KEY = "the-real-access-key";
    const wrong = await unlock(post("guess", "10.1.1.1"), {} as never);
    expect(wrong.status).toBe(400);
    expect(wrong.headers.get("set-cookie")).toBeNull();

    const right = await unlock(post("the-real-access-key", "10.1.1.2"), {} as never);
    expect(right.status).toBe(200);
    const cookie = right.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${ACCESS_COOKIE}=`);
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie).not.toContain("the-real-access-key");

    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await unlock(post(`guess-${i}`, "10.1.1.3"), {} as never)).status);
    expect(statuses.slice(0, 10).every((s) => s === 400)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});
