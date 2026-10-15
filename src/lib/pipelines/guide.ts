import type { SectionKind } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getGenerator, isMockAI } from "@/lib/ai";
import { searchChunks, retrieveForWholeSet, formatRetrievedContext, emptyRetrievalError, type RetrievedChunk } from "@/lib/retrieval";
import { createAnchorsForChunks, chunkMap } from "@/lib/pipelines/anchors";
import {
  guideOutlineSchema,
  guideSectionSchema,
  type GuideOutline,
} from "@/lib/pipelines/schemas";
import { validateGuideSection, filterValidChunkIds, extractInlineChunkIds } from "@/lib/pipelines/validation";
import { GUIDE_OUTLINE_SYSTEM, GUIDE_OUTLINE_USER, GUIDE_SECTION_SYSTEM, GUIDE_SECTION_USER, PROMPT_VERSION } from "@/lib/prompts";
import type { JobContext } from "@/lib/queue/types";
import { audit } from "@/lib/audit";

const STYLE_BY_ENUM: Record<string, string> = {
  EXAM_REVISION: "concise exam revision",
  LECTURE_NOTES: "detailed lecture notes",
  TECHNICAL_OUTLINE: "technical outline",
  CORNELL: "Cornell-style notes (cue column / notes / summary structure)",
  PAPER_NOTES: "research-paper reading notes",
};

interface GuideJobPayload {
  studySetId: string;
  guideId?: string;
  style?: string;
  /** When set, regenerate ONLY these sections (selective regeneration). */
  sectionIds?: string[];
  generationJobId?: string;
}

export async function generateGuideJob(ctx: JobContext<GuideJobPayload>): Promise<void> {
  const { studySetId } = ctx.payload;
  const studySet = await prisma.studySet.findUnique({ where: { id: studySetId } });
  if (!studySet) throw new Error(`Study set ${studySetId} not found`);

  const style = ctx.payload.style ?? "LECTURE_NOTES";
  let guide = ctx.payload.guideId
    ? await prisma.studyGuide.findUnique({ where: { id: ctx.payload.guideId }, include: { sections: true } })
    : await prisma.studyGuide.findFirst({ where: { studySetId, style: style as never }, include: { sections: true } });

  if (!guide) {
    guide = await prisma.studyGuide.create({
      data: { studySetId, style: style as never, title: `${studySet.title} — study guide`, status: "GENERATING" },
      include: { sections: true },
    });
  } else {
    await prisma.studyGuide.update({ where: { id: guide.id }, data: { status: "GENERATING" } });
  }

  try {
    await ctx.updateStage("retrieving-sources", 10);
    // A guide covers the whole set: rank by the set's metadata, but never
    // depend on it matching the material (see retrieveForWholeSet).
    const overviewChunks = await retrieveForWholeSet(studySetId, `${studySet.title} ${studySet.subject ?? ""} ${studySet.course ?? ""}`, { k: 24 });
    if (overviewChunks.length === 0) throw await emptyRetrievalError(studySetId);

    await ctx.updateStage("generating-outline", 25);
    const generator = await getGenerator();
    const outlineRes = await generator.generate({
      system: GUIDE_OUTLINE_SYSTEM,
      user: GUIDE_OUTLINE_USER({
        studySetTitle: studySet.title,
        course: studySet.course,
        subject: studySet.subject,
        learnerLevel: studySet.learnerLevel,
        style: STYLE_BY_ENUM[style] ?? style,
        sourceCount: new Set(overviewChunks.map((c) => c.sourceId)).size,
        chunkContext: formatRetrievedContext(overviewChunks),
      }),
      schema: guideOutlineSchema,
      mock: () => mockOutline(studySet.title, overviewChunks),
    });
    const outline = outlineRes.data;
    await prisma.studyGuide.update({ where: { id: guide.id }, data: { title: outline.title } });

    // Delete existing sections unless this is a selective regeneration.
    const regenerateIds = new Set(ctx.payload.sectionIds ?? []);
    if (regenerateIds.size === 0) {
      await prisma.studyGuideSection.deleteMany({ where: { guideId: guide.id } });
    }

    const total = outline.sections.length;
    const keptSections = guide.sections.filter((s) => regenerateIds.has(s.id));
    let parentMap: Record<number, string | null> = {};

    for (let i = 0; i < total; i++) {
      const sectionSpec = outline.sections[i];
      const sectionChunks = await bestChunksFor(studySetId, sectionSpec.title, sectionSpec.chunkIds, overviewChunks);
      await ctx.updateStage("generating-sections", 30 + Math.round((i / total) * 60));

      const sectionRes = await generator.generate({
        system: GUIDE_SECTION_SYSTEM,
        user: GUIDE_SECTION_USER({
          guideTitle: outline.title,
          sectionTitle: sectionSpec.title,
          sectionKind: sectionSpec.kind,
          learningObjective: sectionSpec.learningObjective,
          style: STYLE_BY_ENUM[style] ?? style,
          chunkContext: formatRetrievedContext(sectionChunks),
          neighborTitles: outline.sections
            .filter((_, j) => j !== i)
            .slice(0, 8)
            .map((s) => s.title),
        }),
        schema: guideSectionSchema,
        mock: () => mockSection(sectionSpec.title, sectionChunks),
      });

      // Ids cited inline in the prose become structured anchors instead of raw text.
      const inline = extractInlineChunkIds(sectionRes.data.content, sectionChunks.map((c) => c.id));
      const section = {
        ...sectionRes.data,
        content: inline.content,
        anchorChunkIds: [...new Set([...sectionRes.data.anchorChunkIds, ...inline.ids])],
      };
      const valid = filterValidChunkIds(sectionSpec.chunkIds, new Set(sectionChunks.map((c) => c.id)));
      const { warnings, anchors } = validateGuideSection(section, sectionChunks.map((c) => c.id));
      const anchorIds = valid.length > 0 ? await createAnchorsForChunks(sectionChunks.filter((c) => valid.includes(c.id))) : [];

      const created = await prisma.studyGuideSection.create({
        data: {
          guideId: guide.id,
          parentId: parentMap[sectionSpec.parentIndex ?? -1] ?? null,
          ordinal: keptSections.length + i,
          kind: sectionSpec.kind.toUpperCase() as SectionKind,
          title: sectionSpec.title,
          content: section.content,
          claimType: sectionRes.data.claimType === "source_grounded" ? "SOURCE_GROUNDED" : sectionRes.data.claimType === "inference" ? "INFERENCE" : "EXTERNAL",
          confidence: sectionRes.data.confidence,
          warnings,
          learningObjective: sectionSpec.learningObjective ?? sectionRes.data.learningObjective,
          anchors: { connect: anchorIds.map((id) => ({ id })) },
        },
      });
      parentMap[i] = created.id;
    }

    // Selective regeneration: remove replaced sections after new ones are in place.
    if (regenerateIds.size > 0) {
      await prisma.studyGuideSection.deleteMany({ where: { id: { in: [...regenerateIds] } } });
    }

    await ctx.updateStage("validating", 95);
    await prisma.studyGuide.update({
      where: { id: guide.id },
      data: {
        status: "READY",
        generatedAt: new Date(),
        metadata: {
          provider: outlineRes.provider,
          model: outlineRes.model,
          promptVersion: PROMPT_VERSION,
          usage: outlineRes.usage,
          sections: total,
          mock: isMockAI(),
        },
      },
    });
    await audit({
      action: "ai.generation",
      entityType: "study_guide",
      entityId: guide.id,
      metadata: { type: "guide", sections: total, provider: outlineRes.provider, promptVersion: PROMPT_VERSION },
    });
    await ctx.updateStage("complete", 100);
  } catch (err) {
    await prisma.studyGuide.update({ where: { id: guide.id }, data: { status: "FAILED" } }).catch(() => undefined);
    throw err;
  }
}

/** Prefer the model's chosen chunks; top up with fresh retrieval for the section topic. */
async function bestChunksFor(
  studySetId: string,
  title: string,
  chunkIds: string[],
  fallback: RetrievedChunk[],
): Promise<RetrievedChunk[]> {
  const known = new Map(fallback.map((c) => [c.id, c]));
  const chosen = chunkIds.map((id) => known.get(id)).filter((c): c is RetrievedChunk => Boolean(c));
  const retrieved = await searchChunks(studySetId, title, { k: 6 });
  const merged = [...chosen];
  for (const r of retrieved) if (!merged.some((m) => m.id === r.id) && merged.length < 8) merged.push(r);
  return merged.length ? merged : fallback.slice(0, 4);
}

// --- Deterministic offline builders -------------------------------------------

function mockOutline(title: string, chunks: RetrievedChunk[]): GuideOutline {
  const bySource = new Map<string, RetrievedChunk[]>();
  for (const c of chunks) {
    const list = bySource.get(c.sourceTitle) ?? [];
    list.push(c);
    bySource.set(c.sourceTitle, list);
  }
  const sections: GuideOutline["sections"] = [
    {
      title: "Learning objectives",
      kind: "objectives",
      learningObjective: "State what this study set's sources cover and what you should be able to do after studying them",
      chunkIds: chunks.slice(0, 2).map((c) => c.id),
      parentIndex: null,
    },
  ];
  let idx = 1;
  for (const [sourceTitle, sourceChunks] of [...bySource.entries()].slice(0, 5)) {
    sections.push({
      title: `Core concepts from ${sourceTitle}`,
      kind: "concept",
      learningObjective: `Explain the key ideas presented in ${sourceTitle}`,
      chunkIds: sourceChunks.map((c) => c.id),
      parentIndex: null,
    });
    for (const chunk of sourceChunks.slice(0, 2)) {
      sections.push({
        title: chunk.heading?.slice(0, 80) ?? `${topicOf(chunk.content)} (detail)`,
        kind: /formula|equation|=|\\frac|\\sum/.test(chunk.content) ? "equations" : "definition",
        chunkIds: [chunk.id],
        parentIndex: idx,
      });
    }
    idx += 3;
  }
  sections.push({
    title: "Summary and recall",
    kind: "summary",
    learningObjective: "Retrieve the structure of the material without looking",
    chunkIds: chunks.slice(-2).map((c) => c.id),
    parentIndex: null,
  });
  return { title: `${title} — study guide`, summary: `Auto-generated outline across ${bySource.size} source(s).`, sections };
}

function mockSection(title: string, chunks: RetrievedChunk[]) {
  const body = chunks
    .slice(0, 3)
    .map((c) => {
      const loc = c.startMs != null ? `transcript ${Math.floor(c.startMs / 60000)}m` : c.page != null ? `page ${c.page}` : "source";
      return `> Material from **${c.sourceTitle}** (${loc}):\n\n${c.content}`;
    })
    .join("\n\n");
  return {
    content: `## ${title}\n\n${body}\n\n**Recall prompts**\n\n- Restate the main claim of this section in your own words.\n- Which assumptions from the source does it depend on?\n\n*(Generated in offline mock mode — configure a real AI provider for full synthesis.)*`,
    claimType: "source_grounded" as const,
    confidence: 0.75,
    warnings: ["Generated by the offline mock generator — configure AI_PROVIDER for real synthesis."],
    anchorChunkIds: chunks.slice(0, 3).map((c) => c.id),
  };
}

function topicOf(content: string): string {
  const words = content.replace(/[^A-Za-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 4);
  return (words.slice(0, 4).join(" ") || "Source detail").replace(/\b\w/g, (m) => m.toUpperCase());
}
