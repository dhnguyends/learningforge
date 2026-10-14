import { vi } from "vitest";
import type { Session } from "next-auth";
import { getServerSession } from "next-auth";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";

/**
 * Shared plumbing for route-handler tests: a mocked Auth.js session, a
 * disposable database user, and NextRequest builders.
 *
 * Test files must import this module BEFORE any route module so the
 * next-auth mock (hoisted to the top of this file) is registered first.
 */

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

export const prisma = new PrismaClient();

export const mockGetServerSession = vi.mocked(getServerSession);

export interface TestUser {
  id: string;
  email: string;
  workspaceId: string;
}

export async function createTestUser(name = "Api Test"): Promise<TestUser> {
  const email = `api-test-${crypto.randomUUID()}@test.lectureforge`;
  const user = await prisma.user.create({
    data: { email, name, passwordHash: await bcrypt.hash("irrelevant-password", 4) },
  });
  const workspace = await prisma.workspace.create({
    data: { name: `${name} workspace`, ownerId: user.id, members: { create: { userId: user.id, role: "OWNER" } } },
  });
  return { id: user.id, email, workspaceId: workspace.id };
}

/** Deleting the user cascades to its workspaces, study sets, and artifacts. */
export async function disposeTestUser(email: string) {
  await prisma.user.deleteMany({ where: { email } });
}

export function signInAs(userId: string | null) {
  mockGetServerSession.mockResolvedValue(
    (userId ? { user: { id: userId }, expires: "9999-01-01" } : null) as Session,
  );
}

export function jsonRequest(url: string, method: "GET" | "POST" | "PATCH" | "DELETE", body?: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
  });
}
