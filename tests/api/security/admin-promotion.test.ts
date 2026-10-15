import { describe, it, expect, beforeAll, afterAll } from "vitest";
import "../helpers";
import { prisma, createTestUser, disposeTestUser, signInAs, jsonRequest, type TestUser } from "../helpers";
import { POST as createUser } from "@/app/api/admin/users/route";
import { PATCH as updateUser } from "@/app/api/admin/users/[userId]/route";
import { GET as listCourses } from "@/app/api/admin/study-sets/route";
import { GET as listStudySets } from "@/app/api/study-sets/route";
import { authOptions } from "@/lib/auth";
import { adminRuleViolation, effectiveRole } from "@/lib/admin";

/**
 * Account nature and Admin promotion:
 * - only Human accounts can be Admin (a Bot is made Human first), enforced by
 *   the API, not just the form;
 * - admin rights really follow the database: a Bot with role ADMIN set
 *   directly still gets 403, and a promotion or demotion reaches the session
 *   token on its next refresh (no sign-out needed);
 * - "last used" is recorded on activity.
 */
const BASE = "http://localhost/api/admin/users";
const ctx = (userId: string) => ({ params: { userId } });
const patch = (userId: string, body: unknown) => updateUser(jsonRequest(`${BASE}/${userId}`, "PATCH", body), ctx(userId));
const created: string[] = [];

let admin: TestUser;
let bot: TestUser;

beforeAll(async () => {
  admin = await createTestUser("Promotion admin");
  await prisma.user.update({ where: { id: admin.id }, data: { role: "ADMIN", nature: "HUMAN" } });
  bot = await createTestUser("A bot");
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { in: created } } });
  await disposeTestUser(admin.email);
  await disposeTestUser(bot.email);
  await prisma.$disconnect();
});

describe("rules", () => {
  it("allows Admin only for Human accounts", () => {
    expect(effectiveRole("ADMIN", "HUMAN")).toBe("ADMIN");
    expect(effectiveRole("ADMIN", "BOT")).toBe("USER");
    expect(adminRuleViolation({ role: "ADMIN", nature: "BOT" })).toMatch(/change the nature to Human first/);
    expect(adminRuleViolation({ role: "ADMIN", nature: "BOT" }, { role: "ADMIN", nature: "HUMAN" })).toMatch(/remove the Admin role/);
    expect(adminRuleViolation({ role: "USER", nature: "BOT" })).toBeNull();
  });
});

describe("promotion through the API", () => {
  it("refuses to create a Bot Admin, and creates a Human Admin", async () => {
    signInAs(admin.id);
    const botAdmin = await createUser(jsonRequest(BASE, "POST", { name: "x", email: `bot-admin-${crypto.randomUUID()}@test.lectureforge`, password: "long-enough-pw", role: "ADMIN" }), {} as never);
    expect(botAdmin.status).toBe(400);
    const email = `human-admin-${crypto.randomUUID()}@test.lectureforge`;
    created.push(email);
    const ok = await createUser(jsonRequest(BASE, "POST", { name: "y", email, password: "long-enough-pw", role: "ADMIN", nature: "HUMAN" }), {} as never);
    expect(ok.status).toBe(201);
    expect((await ok.json()).user).toMatchObject({ role: "ADMIN", nature: "HUMAN" });
  });

  it("promotes a Bot only after it was made Human, and keeps an Admin Human", async () => {
    signInAs(admin.id);
    expect((await patch(bot.id, { role: "ADMIN" })).status).toBe(400);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: bot.id } })).role).toBe("USER");

    expect((await patch(bot.id, { nature: "HUMAN" })).status).toBe(200);
    expect((await patch(bot.id, { role: "ADMIN" })).status).toBe(200);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: bot.id } })).toMatchObject({ role: "ADMIN", nature: "HUMAN" });

    const backToBot = await patch(bot.id, { nature: "BOT" });
    expect(backToBot.status).toBe(400);
    expect((await backToBot.json()).error).toMatch(/remove the Admin role before changing the nature to Bot/);
    expect((await patch(bot.id, { role: "USER", nature: "BOT" })).status).toBe(200);
  });
});

describe("admin rights follow the database", () => {
  it("gives a promoted Human real admin access, and none to a Bot whose role was forced to ADMIN", async () => {
    const person = await createTestUser("Promoted person");
    created.push(person.email);
    await prisma.user.update({ where: { id: person.id }, data: { nature: "HUMAN" } });
    signInAs(person.id);
    expect((await listCourses(jsonRequest(BASE, "GET"), {} as never)).status).toBe(403);

    await prisma.user.update({ where: { id: person.id }, data: { role: "ADMIN" } });
    expect((await listCourses(jsonRequest(BASE, "GET"), {} as never)).status).toBe(200);

    await prisma.user.update({ where: { id: person.id }, data: { nature: "BOT" } }); // bypassing the API
    expect((await listCourses(jsonRequest(BASE, "GET"), {} as never)).status).toBe(403);
  });

  it("refreshes the role in the session token without signing in again", async () => {
    const person = await createTestUser("Token refresh");
    created.push(person.email);
    const jwt = authOptions.callbacks!.jwt!;
    const refresh = (role: string) =>
      jwt({ token: { sub: person.id, role } as never, user: undefined as never, account: null, trigger: "update" } as never);

    expect(await refresh("USER")).toMatchObject({ role: "USER" });
    await prisma.user.update({ where: { id: person.id }, data: { role: "ADMIN", nature: "HUMAN" } });
    expect(await refresh("USER")).toMatchObject({ role: "ADMIN" }); // promotion reaches the token
    await prisma.user.update({ where: { id: person.id }, data: { role: "USER" } });
    expect(await refresh("ADMIN")).toMatchObject({ role: "USER" }); // so does a demotion
  });
});

describe("last used", () => {
  it("is recorded on activity, at most every few minutes", async () => {
    const person = await createTestUser("Active person");
    created.push(person.email);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: person.id } })).lastActiveAt).toBeNull();
    signInAs(person.id);
    await listStudySets(jsonRequest("http://localhost/api/study-sets", "GET"), {} as never);
    const first = (await prisma.user.findUniqueOrThrow({ where: { id: person.id } })).lastActiveAt;
    expect(first).toBeInstanceOf(Date);
    await listStudySets(jsonRequest("http://localhost/api/study-sets", "GET"), {} as never);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: person.id } })).lastActiveAt).toEqual(first);
  });
});
