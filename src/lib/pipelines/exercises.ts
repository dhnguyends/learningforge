import { prisma } from "@/lib/db";
import { getGenerator } from "@/lib/ai";
import { searchChunks, retrieveForWholeSet, wholeSetTokenBudget, formatRetrievedContext, emptyRetrievalError, type RetrievedChunk } from "@/lib/retrieval";
import { createAnchorsForChunks } from "@/lib/pipelines/anchors";
import { exercisesSchema, type ExerciseDraft } from "@/lib/pipelines/schemas";
import { validateExercise, resolveChunkRefs, stripCitationLeaks } from "@/lib/pipelines/validation";
import { EXERCISES_SYSTEM, EXERCISES_USER, PROMPT_VERSION } from "@/lib/prompts";
import type { JobContext } from "@/lib/queue/types";
import { audit } from "@/lib/audit";

interface ExercisesJobPayload {
  studySetId: string;
  exerciseSetId: string;
  generationJobId?: string;
}

export async function generateExercisesJob(ctx: JobContext<ExercisesJobPayload>): Promise<void> {
  const { exerciseSetId } = ctx.payload;
  const exerciseSet = await prisma.exerciseSet.findUnique({
    where: { id: exerciseSetId },
    include: { studySet: { select: { id: true, title: true, learnerLevel: true } } },
  });
  if (!exerciseSet) throw new Error(`Exercise set ${exerciseSetId} not found`);
  const config = exerciseSet.config as {
    count?: number;
    types?: string[];
    difficulty?: string;
    topic?: string;
    groundedOnly?: boolean;
  };

  await ctx.updateStage("retrieving-sources", 15);
  // An explicit topic is a real query; without one the exercises cover the set.
  const chunks = config.topic
    ? await searchChunks(exerciseSet.studySet.id, config.topic, { k: 16 })
    : await retrieveForWholeSet(exerciseSet.studySet.id, exerciseSet.studySet.title, { k: 16, tokenBudget: await wholeSetTokenBudget() });
  if (chunks.length === 0) throw await emptyRetrievalError(exerciseSet.studySet.id);

  await ctx.updateStage("generating-exercises", 45);
  const result = await (await getGenerator()).generate({
    system: EXERCISES_SYSTEM,
    user: EXERCISES_USER({
      studySetTitle: exerciseSet.studySet.title,
      count: config.count ?? 4,
      types: config.types,
      difficulty: config.difficulty,
      learnerLevel: exerciseSet.studySet.learnerLevel,
      chunkContext: formatRetrievedContext(chunks),
    }),
    schema: exercisesSchema,
    mock: () => mockExercises(chunks, config.count ?? 4),
  });

  await ctx.updateStage("validating", 80);
  const chunkIds = chunks.map((c) => c.id);
  const chunkById = new Map(chunks.map((c) => [c.id, c] as const));

  await prisma.exercise.deleteMany({ where: { exerciseSetId } });
  let ordinal = 0;
  let dropped = 0;
  for (const generated of result.data.exercises) {
    const anchored = resolveChunkRefs(generated.chunkIds, chunkIds);
    // A "grounded" exercise that cites nothing verifiable must not be shown as
    // source-derived — but it is still a usable exercise: keep it, honestly
    // relabelled as additional practice (it used to be dropped, and a model
    // that never fills chunkIds made every generation fail).
    const unverified = generated.grounded && anchored.length === 0;
    const clean = (text: string) => stripCitationLeaks(text, chunkIds);
    const draft = {
      ...generated,
      grounded: unverified ? false : generated.grounded,
      prompt: clean(generated.prompt),
      solution: clean(generated.solution),
      hints: generated.hints.map(clean),
      ...(generated.expectedOutput ? { expectedOutput: clean(generated.expectedOutput) } : {}),
    };
    if (config.groundedOnly && !draft.grounded) {
      dropped++;
      continue;
    }
    const warnings = [
      ...validateExercise(draft),
      ...(unverified
        ? ["Marked as source-based by the generator but cited no source passage — shown as additional practice; verify against your sources."]
        : []),
    ];
    const anchorIds = await createAnchorsForChunks(anchored.map((id) => chunkById.get(id)!).filter(Boolean));
    await prisma.exercise.create({
      data: {
        exerciseSetId,
        ordinal: ordinal++,
        type: draft.type.toUpperCase() as never,
        title: draft.title,
        prompt: draft.prompt,
        prerequisites: draft.prerequisites,
        assumptions: draft.assumptions,
        requiredKnowledge: draft.requiredKnowledge,
        expectedOutput: draft.expectedOutput,
        estimatedMinutes: draft.estimatedMinutes,
        difficulty: draft.difficulty.toUpperCase() as never,
        grounded: draft.grounded,
        hints: draft.hints,
        solution: draft.solution,
        warnings,
        anchors: { connect: anchorIds.map((id) => ({ id })) },
      },
    });
  }
  if (ordinal === 0) {
    throw new Error(
      dropped > 0
        ? `None of the ${dropped} generated exercise(s) could be tied to a source passage, and this set only allows source-grounded exercises. Try again, or allow practice exercises.`
        : "Generation produced no exercises.",
    );
  }

  await prisma.exerciseSet.update({
    where: { id: exerciseSetId },
    data: { status: "READY", config: { ...config, promptVersion: PROMPT_VERSION, provider: result.provider } },
  });
  await audit({
    action: "ai.generation",
    entityType: "exercise_set",
    entityId: exerciseSetId,
    metadata: { type: "exercises", created: ordinal, provider: result.provider, promptVersion: PROMPT_VERSION },
  });
  await ctx.updateStage("complete", 100);
}

function mockExercises(chunks: RetrievedChunk[], count: number) {
  const exercises: ExerciseDraft[] = [];
  const byType = ["derivation", "quantitative", "code_debugging", "conceptual_transfer"];
  for (let i = 0; i < Math.min(count, chunks.length); i++) {
    const chunk = chunks[i];
    const type = byType[i % byType.length] as ExerciseDraft["type"];
    exercises.push({
      type,
      title: `${titleCase(type)} from "${chunk.sourceTitle}"`,
      prompt: `Work through the following material from your source (chunk ${
        chunk.startMs != null ? `at ${Math.floor(chunk.startMs / 60000)}m` : `page ${chunk.page ?? 1}`
      }):\n\n> ${chunk.content.slice(0, 500)}\n\n${
        type === "derivation"
          ? "Re-derive the central result above from first principles, stating every assumption you use and flagging any step the source skipped."
          : type === "quantitative"
            ? "Construct one quantitative question whose answer follows from the numbers in the excerpt, then solve it showing units at every step."
            : type === "code_debugging"
              ? "Write a small function implementing the procedure in the excerpt, then add one subtle bug and explain how to detect it via testing."
              : "Explain how the idea above would behave if its central assumption were violated. Predict two consequences and justify each."
      }\n\n*(Offline mock exercise — configure AI_PROVIDER for generated problems.)*`,
      prerequisites: ["Material from the cited source chunk"],
      assumptions: ["The source's own framing applies"],
      requiredKnowledge: [topicOf(chunk.content)],
      expectedOutput:
        type === "code_debugging"
          ? "A code block plus a short test discussion"
          : "Written solution with explicit steps (LaTeX where needed)",
      estimatedMinutes: 20 + i * 10,
      difficulty: i >= 2 ? "hard" : "medium",
      grounded: true,
      hints: [
        "Start by restating what the source claims in your own words.",
        "Identify the quantities/objects involved and their relationships.",
        "Draft the full argument, then check each step against the excerpt.",
      ],
      solution:
        "Model solutions are hidden by design in the UI. (Offline mock: compare your answer against the cited source excerpt and the guide section covering it.)",
      chunkIds: [chunk.id],
      warnings: ["Generated by the offline mock generator."],
    });
  }
  return { exercises };
}

function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function topicOf(content: string): string {
  const words = content.replace(/[^A-Za-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 5);
  return (words.slice(0, 3).join(" ") || "the material").toLowerCase();
}
