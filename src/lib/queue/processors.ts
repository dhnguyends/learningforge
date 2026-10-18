import type { JobName, Processor } from "@/lib/queue/types";
import { ingestSource } from "@/lib/pipelines/ingest";
import { generateGuideJob } from "@/lib/pipelines/guide";
import { generateFlashcardsJob } from "@/lib/pipelines/flashcards";
import { generateQuizJob } from "@/lib/pipelines/quiz";
import { generateExercisesJob } from "@/lib/pipelines/exercises";
import { generateAudioRecapJob } from "@/lib/pipelines/recap";
import { withAiUsage, withSourceAiUsage } from "@/lib/ai/usage";

export type ProcessorRegistry = { [K in JobName]: Processor<K> };

/** All job processors. The BullMQ worker and the inline driver share this map. */
export function getProcessors(): ProcessorRegistry {
  return {
    "ingest.source": (ctx) => withSourceAiUsage(ctx.payload.sourceId, "ingest", () => ingestSource(ctx)),
    "generate.guide": (ctx) => withAiUsage({ studySetId: ctx.payload.studySetId, feature: "guide" }, () => generateGuideJob(ctx)),
    "generate.flashcards": (ctx) => withAiUsage({ studySetId: ctx.payload.studySetId, feature: "flashcards" }, () => generateFlashcardsJob(ctx)),
    "generate.quiz": (ctx) => withAiUsage({ studySetId: ctx.payload.studySetId, feature: "quiz" }, () => generateQuizJob(ctx)),
    "generate.exercises": (ctx) => withAiUsage({ studySetId: ctx.payload.studySetId, feature: "exercises" }, () => generateExercisesJob(ctx)),
    "generate.audio-recap": (ctx) => withAiUsage({ studySetId: ctx.payload.studySetId, feature: "audio-recap" }, () => generateAudioRecapJob(ctx)),
  };
}
