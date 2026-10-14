import { NextRequest } from "next/server";
import { prisma, jsonSafe } from "@/lib/db";
import { apiHandler, ok, requireSession } from "@/lib/api";
import { assertStudySetAccess } from "@/lib/access";

/** Polling endpoint for the processing dashboard (React Query refetchInterval). */
export const GET = apiHandler(async (req: NextRequest) => {
  const session = await requireSession();
  const studySetId = req.nextUrl.searchParams.get("studySetId");

  if (studySetId) {
    await assertStudySetAccess(session.user.id, studySetId);
    const jobs = await prisma.generationJob.findMany({
      where: { studySetId },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return ok(jsonSafe({ jobs }));
  }

  const jobs = await prisma.generationJob.findMany({
    where: { studySet: { workspace: { members: { some: { userId: session.user.id } } } } },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return ok(jsonSafe({ jobs }));
});
