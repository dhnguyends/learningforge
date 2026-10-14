import type { JobName, Processor } from "@/lib/queue/types";
import { ingestSource } from "@/lib/pipelines/ingest";
import { generateGuideJob } from "@/lib/pipelines/guide";
import { generateFlashcardsJob } from "@/lib/pipelines/flashcards";
import { generateQuizJob } from "@/lib/pipelines/quiz";
import { generateExercisesJob } from "@/lib/pipelines/exercises";
import { generateAudioRecapJob } from "@/lib/pipelines/recap";

export type ProcessorRegistry = { [K in JobName]: Processor<K> };

/** All job processors. The BullMQ worker and the inline driver share this map. */
export function getProcessors(): ProcessorRegistry {
  return {
    "ingest.source": ingestSource,
    "generate.guide": generateGuideJob,
    "generate.flashcards": generateFlashcardsJob,
    "generate.quiz": generateQuizJob,
    "generate.exercises": generateExercisesJob,
    "generate.audio-recap": generateAudioRecapJob,
  };
}
