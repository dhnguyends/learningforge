# Architecture

## System overview

```
┌────────────────────────────── Browser ──────────────────────────────┐
│  Next.js App Router (React 18, React Query, Tailwind + shadcn/ui)   │
│  dashboard · create · study-set tools (guide/cards/quiz/exercises/  │
│  tutor/transcript/analytics) · settings                             │
└───────┬──────────────────────────────────────────────┬──────────────┘
        │ fetch /api/*                                  │ SSE-free: React Query
        │                                               │ polling on job routes
┌───────▼──────────────────────────────────────────────▼──────────────┐
│ Next.js API routes (src/app/api/**)                                 │
│  apiHandler wrapper → requireSession → Zod body → access asserts    │
└──┬──────────────┬──────────────┬───────────────┬────────────────────┘
   │              │              │               │
   ▼              ▼              ▼               ▼
┌────────┐  ┌───────────┐  ┌───────────┐  ┌─────────────────────────┐
│Prisma  │  │Job queue  │  │Storage    │  │AI adapter layer         │
│Postgres│  │BullMQ/Redi│  │local | S3 │  │openai|anthropic|local|  │
│+pgvector│ │or inline  │  │signed URLs│  │mock  (src/lib/ai)       │
└────────┘  └─────┬─────┘  └───────────┘  └─────────────────────────┘
                  │                          │
            ┌─────▼──────────────────────────▼──────────┐
            │ Worker (src/workers, npm run worker)      │
            │ ingest → transcribe/parse → chunk →       │
            │ embed → generate outputs → validate       │
            └───────────────────────────────────────────┘
```

Two processes share the same codebase: the **web** process (Next.js) and the
**worker** process (BullMQ consumer). In development `QUEUE_DRIVER=inline`
runs job processors inside the web process so Redis isn't required.

## Multi-tenancy & access

- Every user gets a personal **Workspace** on first use (`OWNER` member).
  Shared workspaces use roles `OWNER | EDITOR | CONTRIBUTOR | VIEWER`.
- `assertStudySetAccess(userId, studySetId, "write"?)` (src/lib/access.ts)
  resolves the study set through workspace membership and is called by every
  study-set-scoped route. Write actions reject `VIEWER`.
- Auth: Auth.js credentials provider, bcrypt (cost 12), JWT sessions,
  middleware-protected routes (`/dashboard`, `/study-sets`, `/settings`).

## Data model (prisma/schema.prisma)

```
Workspace ─< WorkspaceMember >─ User
Workspace ─< StudySet ─< Source ─< SourceAsset (media/audio/pages)
                          │
                          ├─< Transcript ─< TranscriptSegment (word timings)
                          ├─< ExtractedChunk (embedding vector(1536), HNSW)
                          │        └─< CitationAnchor (time range | page)
                          │
                          ├─< StudyGuide ─< StudyGuideSection (claimType)
                          ├─< FlashcardDeck ─< Flashcard ─< FlashcardReview
                          ├─< Quiz ─< QuizQuestion ─< Attempt
                          ├─< ExerciseSet ─< Exercise (hints, rubric)
                          └─< TutorConversation ─< TutorMessage

Cross-cutting: GenerationJob · Attempt (polymorphic) · ProgressMetric
              StudyPlan · StudySession · ArtifactEdit (edit history) · AuditLog
```

Design notes:

- **Attempt is polymorphic** (`subjectType` + `subjectId`, no FK) so
  flashcard reviews, quiz questions, and exercise submissions feed one
  analytics/progress pipeline (`recordAttemptAndProgress` keeps an EWMA
  mastery per learning objective).
- **CitationAnchor** is the grounding primitive: it stores `startMs/endMs`
  for A/V sources and `page` (+ optional region) for documents, plus a short
  excerpt. Every generated artifact references chunks, and chunks reference
  anchors — the chain behind every citation chip in the UI.
- **ArtifactEdit** stores before/after for every user edit of generated
  content (editing is versioned, first-class).
- `embedding vector(1536)` on ExtractedChunk with an HNSW index; the column
  is created by `scripts/db-setup.mjs` (`CREATE EXTENSION vector` must run
  before `prisma db push`).

## Ingest pipeline (`src/lib/pipelines/ingest.ts`, `queue/processors.ts`)

1. **Upload** — `POST /api/study-sets/[id]/sources` returns an upload ticket
   (local driver: `PUT` to a dev route; S3: presigned URLs). `POST
   /api/uploads/complete` verifies the object and enqueues an `INGEST` job.
   Recording sources require `rightsConfirmed: true` (400 otherwise) and
   stamp `consentConfirmedAt`.
2. **Media normalize** — FFmpeg (src/lib/media/ffmpeg.ts) probes/normalizes
   audio for transcription, extracts poster frames, splits long recordings.
3. **Transcribe / parse** — Whisper-compatible or Deepgram for audio
   (word-level timings kept); `documents/parse.ts` for PDF/slides/images into
   a page-structured `ParsedDocument`.
4. **Chunk** (`retrieval/chunking.ts`) — target ~320 tokens, hard max 480;
   breaks on speaker changes, pauses > 2.5 s, and sentence boundaries;
   documents never cross page boundaries; ordinals are stable per source.
5. **Embed** (`ai/embeddings.ts`) — provider embeddings (or deterministic
   hashed vectors in mock mode, pgvector-compatible) written per chunk.
6. **Generate outputs** — guide / deck / quiz / exercises jobs (below) run
   once sources reach `READY`; the study-set page surfaces live job progress.

## Generation pipelines & validation

All generators live in `src/lib/pipelines/` behind a common shape:

- prompts are assembled in `src/lib/prompts/index.ts` (system rules:
  preserve notation, label claim types, cite chunk ids, no invented sources);
- the AI adapter returns **Zod-validated drafts** (`pipelines/schemas.ts`);
- `pipelines/validation.ts` runs rule-based checks before anything is stored:
  quiz questions must have exactly one correct option (MC), no duplicate
  option texts, ≥3 items for ordering/matching, numeric questions need a
  tolerance; guide sections must anchor grounded claims and flag thin
  explanations; flashcards are deduplicated (Jaccard ≥ 0.8); arithmetic in
  exercise solutions is re-verified with a safe expression evaluator;
- every stored artifact row carries `claimType` (`SOURCE_GROUNDED |
  SYNTHESIS | PRACTICE`) and citation anchors, which the UI renders as
  labeled citation chips.

## Retrieval

`src/lib/retrieval/index.ts` — pgvector cosine search over READY chunks,
scoped to the study set, with keyword fallback. Retrieval feeds generation
(grounded context windows), the tutor (context + anchors for citations), and
regeneration constraints ("focus on optimization methods").

## Spaced repetition

`src/lib/srs/` — `FSRS45Scheduler` (default, target retention 0.9) and
`SM2Scheduler` behind one interface. Grades Again/Hard/Good/Easy (1–4) map to
FSRS ratings; the scheduler returns state, stability, interval; the review
route persists card state, a `FlashcardReview` log row, and an `Attempt`.

## Grounded tutor

`pipelines/tutor.ts` — retrieval-grounded Socratic loop. The system prompt
enforces: hint ladders before solutions, "not in your sources" honesty when
retrieval confidence is low, and citation anchors on claims. Full solution
release for exercises goes only through the explicit, audited solution
endpoint.

## Job system

- `src/lib/queue/` — `QUEUE_DRIVER=redis` (BullMQ, per-job-type queues with
  retries/backoff) or `inline` (dev/tests).
- `GenerationJob` rows are the durable record: `QUEUED → RUNNING (progress,
  stage) → SUCCEEDED/FAILED` — the UI polls them for live progress.
- `src/workers/index.ts` claims jobs, updates progress, and writes failures
  back with the error message; `npm run worker:once` is the production entry.

## Provider abstraction (model-agnostic by design)

| Concern | Swappable via | Implementations |
|---|---|---|
| LLM | `AI_PROVIDER` | `openai` · `anthropic` · `local` (Ollama-style) · `mock` |
| Embeddings | `EMBEDDINGS_PROVIDER` | `openai` · `mock` (deterministic hash vectors) |
| Transcription | `TRANSCRIPTION_PROVIDER` | `whisper` (OpenAI-compatible) · `deepgram` · `mock` |
| TTS (audio recap) | `TTS_PROVIDER` | `openai` · `mock` |
| Storage | `STORAGE_DRIVER` | `s3` (or R2/MinIO) · `local` (./.data/storage) |
| Queue | `QUEUE_DRIVER` | `redis` (BullMQ) · `inline` |

Everything is `mock`-able, so the full product — ingest to tutor — runs
offline, deterministically, in CI.

## API conventions

- Success: `ok(data)` returns the payload directly.
- Errors: `{ error: string, code: string }` with proper status —
  `unauthorized` (401), `validation_error` (400), `forbidden` (403),
  `not_found` (404), `rate_limited` (429).
- `apiHandler` wraps every route: session, Zod parsing, error shaping.
- Rate limiting (`lib/rate-limit.ts`) is an in-memory fixed window keyed per
  user+action (e.g. 30 generations/hour) — swap for Redis in production.

## Observability, audit & privacy plumbing

- `AuditLog` (`lib/audit.ts`) records sensitive actions: solution reveals,
  exports, deletions, consent confirmations.
- `GET /api/account/export` serializes a user's full data; `DELETE
  /api/account` purges storage objects (`deletePrefix`) then cascades rows.
- Job failures surface verbatim in the UI (never silent).
- No telemetry on content; provider keys are server-side env only.
