import { z } from "zod";
import { apiHandler, ok, parseJsonBody, requireSession, badRequest } from "@/lib/api";
import { READING_FORMATS, READING_TOPICS, skillFromSlug } from "@/lib/polylingue/practice";
import { createPersonalReading, listPractices } from "@/lib/polylingue/practice-service";

type Ctx = { params: { courseId: string } };

/** The practices of one skill: GET …/practices?skill=reading|listening|writing|speaking */
export const GET = apiHandler<Ctx>(async (req, { params }) => {
  const session = await requireSession();
  const skill = skillFromSlug(new URL(req.url).searchParams.get("skill") ?? "");
  if (!skill) throw badRequest("skill must be reading, listening, writing or speaking");
  return ok(await listPractices(session.user.id, params.courseId, skill));
});

const createSchema = z.object({
  skill: z.literal("reading"),
  format: z.enum(READING_FORMATS.map((f) => f.id) as [string, ...string[]]),
  topic: z.enum(READING_TOPICS.map((t) => t.id) as [string, ...string[]]),
  customTopic: z.string().trim().max(80).optional(),
});

/** Generates a personal reading: a kind of source (newspaper, novel…) on a subject, at the course level. */
export const POST = apiHandler<Ctx>(async (req, { params }) => {
  const session = await requireSession();
  const input = await parseJsonBody(req, createSchema);
  return ok(
    await createPersonalReading(session.user.id, params.courseId, {
      format: input.format as (typeof READING_FORMATS)[number]["id"],
      topic: input.topic as (typeof READING_TOPICS)[number]["id"],
      customTopic: input.customTopic,
    }),
    { status: 201 },
  );
});
