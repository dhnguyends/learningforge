import { describe, it, expect, beforeAll, afterAll } from "vitest";
import "./helpers";
import { prisma, createTestUser, disposeTestUser, signInAs, jsonRequest, type TestUser } from "./helpers";
import { NextRequest } from "next/server";
import { GET as levelsRoute } from "@/app/api/polylingue/courses/[courseId]/levels/route";
import { PATCH as patchCourse } from "@/app/api/polylingue/courses/[courseId]/route";
import { TARGET_LANGUAGES, BASE_LANGUAGES } from "@/lib/polylingue/levels";

/**
 * Change level for the same language: the level list says which shared
 * courses are ready; switching to a level nobody started writes its course
 * (mock model offline); XP and words stay.
 */
const BASE = "http://localhost";
let me: TestUser;
let other: TestUser;
let courseId: string;
let target: string;
let base: string;
const curricula: string[] = [];

beforeAll(async () => {
  me = await createTestUser("Level changer");
  other = await createTestUser("Level outsider");
  // A language / explanation pair with no course at A1, A2 or B1.
  const used = new Set((await prisma.langCurriculum.findMany({ select: { targetLang: true, baseLang: true, level: true } })).map((c) => `${c.targetLang}/${c.baseLang}/${c.level}`));
  const pair = TARGET_LANGUAGES.flatMap((t) => BASE_LANGUAGES.filter((b) => b.code !== t.code).map((b) => [t.code, b.code])).find(
    ([t, b]) => !["A1", "A2", "B1"].some((l) => used.has(`${t}/${b}/${l}`)),
  );
  if (!pair) throw new Error("no unused language pair");
  [target, base] = pair;
  const c = await prisma.langCurriculum.create({ data: { targetLang: target, baseLang: base, level: "A1", status: "READY" } });
  curricula.push(c.id);
  courseId = (await prisma.languageCourse.create({ data: { userId: me.id, targetLang: target, baseLang: base, level: "A1", curriculumId: c.id, xp: 250 } })).id;
});

afterAll(async () => {
  await disposeTestUser(me.email);
  await disposeTestUser(other.email);
  await prisma.langCurriculum.deleteMany({ where: { id: { in: curricula } } });
  await prisma.$disconnect();
});

const ctx = () => ({ params: { courseId } });

describe("change level", () => {
  it("lists the levels: the current one, ready ones, and ones still to write", async () => {
    signInAs(me.id);
    const r = await (await levelsRoute(new NextRequest(`${BASE}/x`), ctx())).json();
    expect(r.level).toBe("A1");
    expect(r.levels.find((l: { level: string }) => l.level === "A1")).toMatchObject({ current: true, status: "READY" });
    expect(r.levels.find((l: { level: string }) => l.level === "B1")).toMatchObject({ current: false, status: "NEW" });
    expect(r.levels).toHaveLength(6);
    expect(r.classes).toEqual([]);
  });

  it("switches to a level nobody started: its course is written, XP stays", async () => {
    signInAs(me.id);
    const res = await patchCourse(jsonRequest(`${BASE}/x`, "PATCH", { level: "B1" }), ctx());
    expect(res.status).toBe(200);
    const course = await prisma.languageCourse.findUniqueOrThrow({ where: { id: courseId }, include: { curriculum: true } });
    expect(course).toMatchObject({ level: "B1", xp: 250, baseLang: base });
    curricula.push(course.curriculumId);
    expect(course.curriculum).toMatchObject({ targetLang: target, baseLang: base, level: "B1" });
    let status = course.curriculum.status;
    for (let i = 0; i < 100 && status !== "READY"; i++) {
      await new Promise((r) => setTimeout(r, 100));
      status = (await prisma.langCurriculum.findUniqueOrThrow({ where: { id: course.curriculumId } })).status;
    }
    expect(status).toBe("READY");
    expect(await prisma.langLesson.count({ where: { curriculumId: course.curriculumId } })).toBeGreaterThan(0);
    const r = await (await levelsRoute(new NextRequest(`${BASE}/x`), ctx())).json();
    expect(r.levels.find((l: { level: string }) => l.level === "B1")).toMatchObject({ current: true, status: "READY" });
  });

  it("goes back to a ready level without writing anything", async () => {
    signInAs(me.id);
    const before = await prisma.langCurriculum.count();
    await patchCourse(jsonRequest(`${BASE}/x`, "PATCH", { level: "A1" }), ctx());
    expect(await prisma.langCurriculum.count()).toBe(before);
    expect((await prisma.languageCourse.findUniqueOrThrow({ where: { id: courseId } })).curriculumId).toBe(curricula[0]);
  });

  it("is the learner's own course only", async () => {
    signInAs(other.id);
    expect((await levelsRoute(new NextRequest(`${BASE}/x`), ctx())).status).toBe(404);
    expect((await patchCourse(jsonRequest(`${BASE}/x`, "PATCH", { level: "A2" }), ctx())).status).toBe(404);
  });
});
