import { z } from "zod";

/** Structured-output contracts for every generation call (validated by Zod). */

export const claimTypeEnum = z.enum(["source_grounded", "inference", "external"]);
export const difficultyEnum = z.enum(["easy", "medium", "hard", "advanced"]);

// --- Study guide -------------------------------------------------------------

export const guideOutlineSectionSchema = z.object({
  title: z.string().min(3).max(120),
  kind: z.enum([
    "objectives",
    "vocabulary",
    "concept",
    "definition",
    "equations",
    "derivation",
    "worked_example",
    "misconceptions",
    "prerequisites",
    "recall",
    "summary",
  ]),
  learningObjective: z.string().max(200).optional(),
  /** Chunk ids from the retrieval context this section draws on. */
  chunkIds: z.array(z.string()).min(1),
  /** Index of the parent section in the same array, or null for top level. */
  parentIndex: z.number().int().nullable(),
});

export const guideOutlineSchema = z.object({
  title: z.string().min(3).max(160),
  summary: z.string().max(600),
  sections: z.array(guideOutlineSectionSchema).min(1).max(24),
});

export const guideSectionSchema = z.object({
  content: z.string().min(1),
  claimType: claimTypeEnum,
  confidence: z.number().min(0).max(1),
  warnings: z.array(z.string()).default([]),
  /** Chunk ids actually cited in the content. */
  anchorChunkIds: z.array(z.string()).default([]),
  learningObjective: z.string().optional(),
});

// --- Flashcards ---------------------------------------------------------------

export const flashcardDraftSchema = z.object({
  type: z.enum(["basic", "cloze", "equation", "image_label", "code_completion", "conceptual"]),
  front: z.string().min(3),
  back: z.string().min(1),
  tags: z.array(z.string()).default([]),
  chunkId: z.string(),
  supportingChunkIds: z.array(z.string()).default([]),
});

export const flashcardsSchema = z.object({
  cards: z.array(flashcardDraftSchema).min(1),
});

// --- Quiz ----------------------------------------------------------------------

export const quizOptionSchema = z.object({ id: z.string(), text: z.string().min(1) });

export const quizAnswerSchema = z.object({
  /** multiple_choice / multi_select: correct option ids. */
  correctIds: z.array(z.string()).optional(),
  /** short_answer: acceptable answers (first is canonical). */
  text: z.array(z.string()).optional(),
  /** numerical: { value, tolerance?, unit? }. */
  numeric: z.object({ value: z.number(), tolerance: z.number().optional(), unit: z.string().optional() }).optional(),
  /** ordering: option ids in correct order. */
  order: z.array(z.string()).optional(),
  /** matching: correct left-right pairs (option id ↔ value). */
  pairs: z.array(z.object({ optionId: z.string(), value: z.string() })).optional(),
});

export const quizQuestionDraftSchema = z.object({
  type: z.enum([
    "multiple_choice",
    "multi_select",
    "short_answer",
    "ordering",
    "matching",
    "derivation_steps",
    "code_tracing",
    "numerical",
  ]),
  stem: z.string().min(10),
  /**
   * Required (empty for short_answer / numerical / code_tracing): when it was
   * optional, schema-constrained local models (Gemma 4) simply omitted it and
   * every choice question arrived with nothing to choose from.
   */
  options: z.array(quizOptionSchema),
  answer: quizAnswerSchema,
  explanation: z.string().min(10),
  distractorRationale: z.record(z.string()).optional(),
  learningObjective: z.string().min(8),
  difficulty: difficultyEnum,
  chunkId: z.string(),
  warnings: z.array(z.string()).default([]),
});

export const quizSchema = z.object({
  title: z.string().min(3).max(160),
  questions: z.array(quizQuestionDraftSchema).min(1),
});

// --- Exercises -------------------------------------------------------------------

export const exerciseDraftSchema = z.object({
  type: z.enum([
    "derivation",
    "quantitative",
    "proof",
    "algorithm_design",
    "code_completion",
    "code_debugging",
    "conceptual_transfer",
    "paper_critique",
  ]),
  title: z.string().min(3).max(160),
  prompt: z.string().min(20),
  prerequisites: z.array(z.string()).default([]),
  assumptions: z.array(z.string()).default([]),
  requiredKnowledge: z.array(z.string()).default([]),
  expectedOutput: z.string().optional(),
  estimatedMinutes: z.number().int().min(3).max(180),
  difficulty: difficultyEnum,
  grounded: z.boolean(),
  hints: z.array(z.string()).length(3),
  solution: z.string().min(20),
  /** Ids of the source chunks the exercise is based on (required: grounded=true needs at least one). */
  chunkIds: z.array(z.string()),
  warnings: z.array(z.string()).default([]),
});

export const exercisesSchema = z.object({
  exercises: z.array(exerciseDraftSchema).min(1),
});

// --- Tutor ------------------------------------------------------------------------

export const tutorResponseSchema = z.object({
  answer: z.string().min(1),
  claimType: claimTypeEnum,
  citations: z
    .array(z.object({ chunkId: z.string(), excerpt: z.string().min(1) }))
    .default([]),
  followUpQuestion: z.string().default(""),
  foundInSources: z.boolean(),
  warnings: z.array(z.string()).default([]),
});

// --- Audio recap --------------------------------------------------------------------

export const recapSchema = z.object({
  script: z.string().min(40),
  sectionsCovered: z.array(z.string()).default([]),
  selfCheckQuestion: z.string(),
});

export type GuideOutline = z.infer<typeof guideOutlineSchema>;
export type GuideSectionContent = z.infer<typeof guideSectionSchema>;
export type FlashcardDraft = z.infer<typeof flashcardDraftSchema>;
export type QuizDraft = z.infer<typeof quizSchema>;
export type QuizQuestionDraft = z.infer<typeof quizQuestionDraftSchema>;
export type ExerciseDraft = z.infer<typeof exerciseDraftSchema>;
export type TutorResponse = z.infer<typeof tutorResponseSchema>;
export type RecapDraft = z.infer<typeof recapSchema>;
