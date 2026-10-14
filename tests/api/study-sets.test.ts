import { describe, it, expect, beforeAll, afterAll } from "vitest";
import "./helpers";
import { prisma, createTestUser, disposeTestUser, signInAs, jsonRequest, type TestUser } from "./helpers";
import { GET as listStudySets, POST as createStudySet } from "@/app/api/study-sets/route";

/**
 * Study-set API contract: auth enforcement, rights confirmation for
 * recordings (spec requirement), workspace isolation of the list view.
 */

let me: TestUser;
let other: TestUser;

beforeAll(async () => {
  me = await createTestUser("Main");
  other = await createTestUser("Other");
});

afterAll(async () => {
  await disposeTestUser(me.email);
  await disposeTestUser(other.email);
  await prisma.$disconnect();
});

describe("GET /api/study-sets", () => {
  it("rejects unauthenticated requests with 401", async () => {
    signInAs(null);
    const res = await listStudySets(jsonRequest("http://localhost/api/study-sets", "GET"), {} as never);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe("unauthorized");
  });

  it("lists only the caller's workspace study sets with counts", async () => {
    const mine = await prisma.studySet.create({
      data: { workspaceId: me.workspaceId, createdById: me.id, title: "My tensors study set" },
    });
    const theirs = await prisma.studySet.create({
      data: { workspaceId: other.workspaceId, createdById: other.id, title: "Someone else's set" },
    });

    signInAs(me.id);
    const res = await listStudySets(jsonRequest("http://localhost/api/study-sets", "GET"), {} as never);
    expect(res.status).toBe(200);
    const sets = (await res.json()) as Array<{ id: string; title: string; counts: { sources: number } }>;
    const ids = sets.map((s) => s.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(theirs.id);
    const mineRow = sets.find((s) => s.id === mine.id)!;
    expect(mineRow.counts).toMatchObject({ sources: 0, decks: 0 });
  });
});

describe("POST /api/study-sets", () => {
  it("rejects unauthenticated requests with 401", async () => {
    signInAs(null);
    const res = await createStudySet(
      jsonRequest("http://localhost/api/study-sets", "POST", { title: "Nope" }),
      {} as never,
    );
    expect(res.status).toBe(401);
  });

  it("rejects invalid bodies with 400 validation_error", async () => {
    signInAs(me.id);
    const res = await createStudySet(
      jsonRequest("http://localhost/api/study-sets", "POST", { title: "ab" }),
      {} as never,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("validation_error");
  });

  it("creates a study set (defaults applied) and returns 201", async () => {
    signInAs(me.id);
    const res = await createStudySet(
      jsonRequest("http://localhost/api/study-sets", "POST", {
        title: "Convex optimization",
        course: "EE 520",
        learnerLevel: "GRADUATE",
        outputTypes: ["GUIDE", "FLASHCARDS"],
      }),
      {} as never,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { studySet: { id: string; language: string; settings: Record<string, unknown> } };
    expect(body.studySet.id).toBeTruthy();
    // Privacy default from the spec: external material off unless enabled.
    expect(body.studySet.settings).toMatchObject({ includeExternal: false });
    expect(body.studySet.language).toBe("en");
  });

  it("requires explicit rights confirmation before accepting a recording upload", async () => {
    signInAs(me.id);
    const res = await createStudySet(
      jsonRequest("http://localhost/api/study-sets", "POST", {
        title: "Seminar recordings",
        rightsConfirmed: false,
        sources: [{ kind: "file", filename: "seminar.mp4", mimeType: "video/mp4", sizeBytes: 5_000_000 }],
      }),
      {} as never,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/rights/i);
  });

  it("accepts a recording when rights are confirmed and creates a pending upload", async () => {
    signInAs(me.id);
    const res = await createStudySet(
      jsonRequest("http://localhost/api/study-sets", "POST", {
        title: "Seminar recordings",
        rightsConfirmed: true,
        sources: [{ kind: "file", filename: "seminar.mp4", mimeType: "video/mp4", sizeBytes: 5_000_000 }],
      }),
      {} as never,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      sources: { id: string; kind: string; upload: { uploadUrl: string; key: string } }[];
    };
    expect(body.sources).toHaveLength(1);
    expect(body.sources[0].upload.uploadUrl).toBeTruthy();
    const source = await prisma.source.findUnique({ where: { id: body.sources[0].id } });
    expect(source?.status).toBe("PENDING_UPLOAD");
    // Consent timestamp recorded (spec: clear consent before processing recordings).
    expect(source?.consentConfirmedAt).toBeTruthy();
  });
});
