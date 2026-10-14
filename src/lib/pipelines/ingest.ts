import type { Source, SourceAsset } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { getTranscriber } from "@/lib/transcription";
import { extractAudio, probeMedia, fetchYouTubeAudio } from "@/lib/media/ffmpeg";
import { parseDocument } from "@/lib/documents/parse";
import { chunkTranscript, chunkDocument } from "@/lib/retrieval/chunking";
import { indexChunks } from "@/lib/retrieval";
import type { JobContext } from "@/lib/queue/types";
import { enqueue } from "@/lib/queue";
import { audit } from "@/lib/audit";

/**
 * Ingestion orchestrator (job stages mirror the UI processing dashboard):
 *   probing → extracting-audio → transcribing → parsing-document
 *   → segmenting → vectorizing → indexing → (optional) auto-generating artifacts
 *
 * The UI collapses these into: uploading → extracting text → chunking
 * → vectorizing → indexing (see src/lib/pipeline-phases.ts).
 */
export async function ingestSource(ctx: JobContext<{ sourceId: string }>): Promise<void> {
  const { sourceId } = ctx.payload;
  const source = await prisma.source.findUnique({
    where: { id: sourceId },
    include: { assets: true, studySet: { include: { sources: true } } },
  });
  if (!source) throw new Error(`Source ${sourceId} not found`);

  await prisma.source.update({ where: { id: sourceId }, data: { status: "PROCESSING", error: null } });

  try {
    if (["VIDEO", "AUDIO", "YOUTUBE"].includes(source.type)) {
      await ingestAudioVideo(source, ctx);
    } else {
      await ingestDocument(source, ctx);
    }
    await prisma.source.update({ where: { id: sourceId }, data: { status: "READY" } });
    await audit({
      action: "source.ingested",
      entityType: "source",
      entityId: sourceId,
      metadata: { type: source.type, studySetId: source.studySetId },
    });
    await maybeAutoGenerate(source.studySetId);
  } catch (err) {
    await prisma.source.update({
      where: { id: sourceId },
      data: { status: "FAILED", error: err instanceof Error ? err.message : String(err) },
    });
    throw err;
  }
}

// --- Audio / video path -------------------------------------------------------

async function ingestAudioVideo(source: Source & { assets: SourceAsset[] }, ctx: JobContext<{ sourceId: string }>): Promise<void> {
  await ctx.updateStage("probing", 5);

  let audioBuffer: Buffer;
  let durationSec = source.durationSec ?? 0;
  let audioAsset: SourceAsset | undefined;

  if (source.type === "YOUTUBE" && source.externalUrl) {
    await ctx.updateStage("fetching-source", 15);
    const key = `${source.id}/audio.mp3`;
    const fetched = await fetchYouTubeAudio(source.externalUrl, key);
    audioBuffer = await getStorage().read(key);
    durationSec = fetched.durationSec || durationSec;
    audioAsset = await prisma.sourceAsset.create({
      data: {
        sourceId: source.id,
        kind: "AUDIO",
        storageKey: key,
        filename: "youtube-audio.mp3",
        mimeType: "audio/mpeg",
        sizeBytes: BigInt(audioBuffer.byteLength),
        durationSec,
      },
    });
  } else {
    const original = source.assets.find((a) => a.kind === "ORIGINAL");
    if (!original) throw new Error("Original media asset missing — was the upload completed?");
    const originalBuffer = await getStorage().read(original.storageKey);

    if (source.type === "VIDEO") {
      try {
        const probe = await probeMedia(originalBuffer, original.filename);
        durationSec = probe.durationSec || durationSec;
        await prisma.sourceAsset.update({
          where: { id: original.id },
          data: { durationSec: probe.durationSec, metadata: probe as object },
        });
      } catch (err) {
        ctx.log("ffprobe failed; continuing with declared duration", { error: String(err) });
      }

      await ctx.updateStage("extracting-audio", 20);
      const key = `${source.id}/audio.mp3`;
      const extracted = await extractAudio(originalBuffer, original.filename, key);
      durationSec = extracted.durationSec || durationSec;
      audioBuffer = await getStorage().read(key);
      audioAsset = await prisma.sourceAsset.create({
        data: {
          sourceId: source.id,
          kind: "AUDIO",
          storageKey: key,
          filename: "extracted-audio.mp3",
          mimeType: "audio/mpeg",
          sizeBytes: BigInt(audioBuffer.byteLength),
          durationSec: extracted.durationSec,
        },
      });
    } else {
      audioBuffer = originalBuffer;
      audioAsset = original;
    }
  }

  const studySetRow = await prisma.studySet.findUnique({ where: { id: source.studySetId }, select: { settings: true } });
  const settings = (studySetRow?.settings as Record<string, unknown> | null | undefined) ?? {};
  await ctx.updateStage("transcribing", 45);
  const transcript = await getTranscriber().transcribe(audioBuffer, "audio.mp3", {
    language: (settings.transcriptLanguage as string) ?? source.language ?? undefined,
    diarize: settings.diarization === true,
    expectedDurationSec: durationSec || undefined,
  });

  const wordCount = transcript.segments.reduce((n, s) => n + s.text.split(/\s+/).filter(Boolean).length, 0);
  const record = await prisma.transcript.upsert({
    where: { id: await prisma.transcript.findFirst({ where: { sourceId: source.id }, select: { id: true } }).then((t) => t?.id ?? "") },
    update: {
      language: transcript.language,
      provider: transcript.provider,
      status: "READY",
      wordCount,
      segmentCount: transcript.segments.length,
      metadata: transcript.metadata as object,
      segments: { deleteMany: {} },
    },
    create: {
      sourceId: source.id,
      language: transcript.language,
      provider: transcript.provider,
      status: "READY",
      wordCount,
      segmentCount: transcript.segments.length,
      metadata: transcript.metadata as object,
    },
  });
  await prisma.transcriptSegment.createMany({
    data: transcript.segments.map((s, idx) => ({
      transcriptId: record.id,
      idx,
      startMs: s.startMs,
      endMs: s.endMs,
      speaker: s.speaker ?? null,
      text: s.text,
      confidence: s.confidence ?? null,
    })),
  });

  await prisma.source.update({
    where: { id: source.id },
    data: {
      durationSec: durationSec ?? (typeof transcript.metadata.durationSec === "number" ? transcript.metadata.durationSec : null),
      metadata: {
        ...(source.metadata as object),
        transcriptProvider: transcript.provider,
        diarized: Boolean(transcript.segments.some((s) => s.speaker)),
      },
    },
  });
  void audioAsset;

  await ctx.updateStage("segmenting", 70);
  const chunks = chunkTranscript(transcript.segments);
  await indexAndFinish(source, chunks, ctx);
}

// --- Document path --------------------------------------------------------------

async function ingestDocument(source: Source & { assets: SourceAsset[] }, ctx: JobContext<{ sourceId: string }>): Promise<void> {
  const original = source.assets.find((a) => a.kind === "ORIGINAL");
  if (!original) throw new Error("Original document asset missing — was the upload completed?");

  await ctx.updateStage("parsing-document", 25);
  const buffer = await getStorage().read(original.storageKey);
  const parsed = await parseDocument(buffer, original.filename, original.mimeType);

  await prisma.source.update({
    where: { id: source.id },
    data: { metadata: { ...(source.metadata as object), pageCount: parsed.pageCount, format: String(parsed.metadata.format ?? "unknown") } },
  });

  await ctx.updateStage("segmenting", 65);
  const chunks = chunkDocument(parsed);
  await indexAndFinish(source, chunks, ctx);
}

async function indexAndFinish(
  source: Source,
  chunks: Awaited<ReturnType<typeof chunkTranscript>>,
  ctx: JobContext<{ sourceId: string }>,
): Promise<void> {
  // indexChunks reports the vectorizing + indexing stage transitions itself.
  const indexed = await indexChunks(source.id, chunks, (stage, progress) => ctx.updateStage(stage, progress));
  ctx.log(`indexed ${indexed.length} chunks for source ${source.id}`);
  await ctx.updateStage("complete", 100);
}

// --- Auto-generation after first successful ingest --------------------------------

async function maybeAutoGenerate(studySetId: string): Promise<void> {
  const studySet = await prisma.studySet.findUnique({
    where: { id: studySetId },
    include: { sources: { select: { status: true } }, guides: { select: { id: true } }, decks: { select: { id: true } } },
  });
  if (!studySet) return;
  const settings = studySet.settings as Record<string, unknown>;
  const outputs = studySet.outputTypes;
  const readyCount = studySet.sources.filter((s) => s.status === "READY").length;
  if (readyCount === 0 || outputs.length === 0) return;
  // Only auto-generate once the first source is ready (user can regenerate later).
  if (readyCount > 1 && settings.autoGenerate !== "always") return;

  const created: { id: string; type: string }[] = [];
  if (outputs.includes("GUIDE") && studySet.guides.length === 0) {
    const guide = await prisma.studyGuide.create({
      data: { studySetId, title: `${studySet.title} — study guide`, status: "QUEUED" },
    });
    created.push({ id: guide.id, type: "guide" });
  }
  if (outputs.includes("FLASHCARDS") && studySet.decks.length === 0) {
    const deck = await prisma.flashcardDeck.create({ data: { studySetId, name: "Core concepts" } });
    created.push({ id: deck.id, type: "flashcards" });
  }

  for (const item of created) {
    const job = await prisma.generationJob.create({
      data: {
        studySetId,
        type: item.type === "guide" ? "GENERATE_GUIDE" : "GENERATE_FLASHCARDS",
        payload: { [item.type === "guide" ? "guideId" : "deckId"]: item.id },
      },
    });
    if (item.type === "guide") {
      await enqueue("generate.guide", { studySetId, guideId: item.id, generationJobId: job.id });
    } else {
      await enqueue("generate.flashcards", { studySetId, deckId: item.id, generationJobId: job.id });
    }
  }
}
