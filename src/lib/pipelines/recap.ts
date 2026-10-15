import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { getGenerator } from "@/lib/ai";
import { recapSchema } from "@/lib/pipelines/schemas";
import { AUDIO_RECAP_SYSTEM, PROMPT_VERSION } from "@/lib/prompts";
import type { JobContext } from "@/lib/queue/types";
import { getStorage, studySetRecapKey } from "@/lib/storage";
import { audit } from "@/lib/audit";

/** Audio recap: guide sections → 90s script → TTS audio asset (when provider available). */
export async function generateAudioRecapJob(ctx: JobContext<{ studySetId: string; guideId: string }>): Promise<void> {
  const guide = await prisma.studyGuide.findUnique({
    where: { id: ctx.payload.guideId },
    include: { sections: { orderBy: { ordinal: "asc" } }, studySet: { select: { id: true, title: true, workspaceId: true } } },
  });
  if (!guide) throw new Error("Guide not found");
  const grounded = guide.sections.filter((s) => s.claimType === "SOURCE_GROUNDED");
  const sourceText = grounded
    .map((s) => `# ${s.title}\n${s.content}`)
    .join("\n\n")
    .slice(0, 24_000);

  await ctx.updateStage("writing-script", 30);
  const result = await (await getGenerator()).generate({
    system: AUDIO_RECAP_SYSTEM,
    user: `STUDY SET: "${guide.studySet.title}"\nGUIDE (source-grounded sections only):\n\n${sourceText}`,
    schema: recapSchema,
    mock: () => ({
      script: `Recap of ${guide.studySet.title}. ${grounded
        .slice(0, 4)
        .map((s) => s.title)
        .join(". Then, ")}. That is the core arc of this lecture.`,
      sectionsCovered: grounded.slice(0, 6).map((s) => s.title),
      selfCheckQuestion: `Can you restate "${grounded[0]?.title ?? "the main topic"}" without looking?`,
    }),
  });

  await ctx.updateStage("synthesizing-audio", 70);
  const env = getEnv();
  let audioKey: string | null = null;
  if (env.TTS_PROVIDER === "openai" && env.OPENAI_API_KEY) {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    const mp3 = await client.audio.speech.create({
      model: env.TTS_MODEL,
      voice: env.TTS_VOICE as "alloy",
      input: result.data.script.slice(0, 4000),
    });
    const buffer = Buffer.from(await mp3.arrayBuffer());
    audioKey = studySetRecapKey(guide.studySet.workspaceId, guide.studySet.id, guide.id, Date.now());
    await getStorage().put(audioKey, buffer, { contentType: "audio/mpeg" });
  }

  await prisma.studyGuide.update({
    where: { id: guide.id },
    data: {
      metadata: {
        ...(guide.metadata as object),
        recap: {
          script: result.data.script,
          sectionsCovered: result.data.sectionsCovered,
          selfCheckQuestion: result.data.selfCheckQuestion,
          audioKey,
          ttsProvider: env.TTS_PROVIDER,
          promptVersion: PROMPT_VERSION,
        },
      },
    },
  });
  await audit({ action: "ai.generation", entityType: "study_guide", entityId: guide.id, metadata: { type: "audio_recap", provider: result.provider } });
  await ctx.updateStage("complete", 100);
}
