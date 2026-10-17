import { describe, it, expect, beforeAll, afterAll } from "vitest";
import "./helpers";
import { prisma, createTestUser, disposeTestUser, signInAs, type TestUser } from "./helpers";
import { NextRequest } from "next/server";
import { GET as analytics } from "@/app/api/study-sets/[studySetId]/analytics/route";

/**
 * Study set analytics once the learner has mastery data: the topic trends
 * read the quiz timeline (they used to read it before it existed, and the
 * page stayed on its loading placeholder with a 500).
 */
let me: TestUser;
let studySetId: string;

beforeAll(async () => {
  me = await createTestUser("Analytics learner");
  studySetId = (await prisma.studySet.create({ data: { workspaceId: me.workspaceId, createdById: me.id, title: "Analytics set" } })).id;
  await prisma.progressMetric.createMany({
    data: [
      { userId: me.id, studySetId, topic: "Chain rule", mastery: 0.4, attempts: 3, correct: 1 },
      { userId: me.id, studySetId, topic: "Adjoints", mastery: 0.9, attempts: 2, correct: 2 },
    ],
  });
});

afterAll(async () => {
  await disposeTestUser(me.email);
  await prisma.$disconnect();
});

describe("study set analytics", () => {
  it("answers with topics, weakest first, and a recommendation", async () => {
    signInAs(me.id);
    const res = await analytics(new NextRequest(`http://localhost/api/study-sets/${studySetId}/analytics`), { params: { studySetId } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.topics).toEqual([
      { topic: "Chain rule", mastery: 0.4, attempts: 3, trend: "flat" },
      { topic: "Adjoints", mastery: 0.9, attempts: 2, trend: "flat" },
    ]);
    expect(body.recommendations[0]).toMatchObject({ kind: "quiz" });
  });
});
