export interface JobPayloadMap {
  "ingest.source": { sourceId: string; generationJobId?: string };
  "generate.guide": { studySetId: string; guideId?: string; style?: string; sectionIds?: string[]; generationJobId?: string };
  "generate.flashcards": { studySetId: string; deckId: string; generationJobId?: string };
  "generate.quiz": { studySetId: string; quizId: string; generationJobId?: string };
  "generate.exercises": { studySetId: string; exerciseSetId: string; generationJobId?: string };
  "generate.audio-recap": { studySetId: string; guideId: string; generationJobId?: string };
}

export type JobName = keyof JobPayloadMap;

export interface JobContext<P> {
  payload: P;
  generationJobId?: string;
  updateStage(stage: string, progress?: number): Promise<void>;
  log(message: string, data?: Record<string, unknown>): void;
}

export type Processor<K extends JobName> = (ctx: JobContext<JobPayloadMap[K]>) => Promise<void>;

export interface EnqueueOptions {
  /** GenerationJob row created by the API layer; the processor updates it. */
  generationJobId?: string;
  /** BullMQ job id — deduplicates retries of the same logical task. */
  jobId?: string;
}
