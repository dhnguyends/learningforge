# Development guide

## Prerequisites

- Node.js ≥ 20 and npm
- Docker Desktop (or any container runtime) for Postgres + Redis
- FFmpeg on PATH if you ingest real media (mock mode needs nothing)

## First run

```bash
npm install
docker compose up -d db            # Postgres 16 + pgvector, host port 5433
cp .env.example .env               # works as-is in mock mode
npm run db:setup                   # vector extension → prisma db push → HNSW index
npm run db:seed                    # demo account + fully processed study set
npm run dev                        # http://localhost:3000
```

Demo login: **demo@learningforge.app / demo-password**.

`npm run db:setup` exists because `prisma db push` cannot create the
`vector` extension itself, and the `embedding vector(1536)` column plus the
HNSW index must exist before seeding. It is idempotent — safe to re-run.

Optional extras:

```bash
docker compose --profile storage up -d   # MinIO (S3-compatible) on :9000
docker compose up -d redis               # Redis for QUEUE_DRIVER=redis
npm run worker                           # separate worker process (watch mode)
node scripts/verify-seed.mjs             # sanity-check seeded data counts
```

## Postgres on port 5433

The dev container publishes **5433:5432**, and `.env` points at
`localhost:5433`. This is deliberate:

On Windows machines with WSL, `wslrelay.exe` (or any native Postgres) often
binds `127.0.0.1:5432` *specifically*. Docker's port publish binds
`0.0.0.0:5432` — and a process bound to the specific address silently wins.
Connections to `localhost:5432` then reach **a different Postgres server**
(another project's, with different databases), while everything looks like
it "should work". Symptoms are bizarre: `prisma db push` fails with
`P1014 The underlying table for model extracted_chunks does not exist`
even after a clean push, seed data never appears, users vanish.

Moving to 5433 sidesteps the shadow entirely. If you change it back, verify
which server you're actually talking to:

```bash
docker ps --format "{{.Names}} {{.Ports}}"        # what Docker publishes
psql "postgresql://lectureforge:lectureforge@localhost:5433/lectureforge" -c "select version();"
```

The container image is `pgvector/pgvector:pg16`; if a host connection
reports a different version or unknown tables, you are talking to the wrong
server.

## Environment

`.env.example` documents every variable. Highlights:

| Variable | Values | Notes |
|---|---|---|
| `DATABASE_URL` | — | Points at 5433 locally (see above) |
| `QUEUE_DRIVER` | `inline` \| `redis` | `inline` runs jobs in the web process — dev/test only |
| `STORAGE_DRIVER` | `local` \| `s3` | `local` writes `./.data/storage` |
| `AI_PROVIDER` | `mock` \| `openai` \| `anthropic` \| `local` \| `gemini` \| `zai` | `local` = Ollama-style `/api/chat`; administrators can switch at `/admin` |
| `EMBEDDINGS_PROVIDER` | `mock` \| `openai` \| `ollama` | Mock = deterministic hashed 1536-d vectors; `ollama` = EmbeddingGemma |
| `TRANSCRIPTION_PROVIDER` | `mock` \| `whisper` \| `deepgram` | Segment start/end timestamps kept for citations; see *Local speech-to-text* below |
| `TTS_PROVIDER` | `mock` \| `openai` | Audio recap voice |
| `NEXTAUTH_SECRET` | — | `openssl rand -base64 32`; dev fallback exists but don't ship it |

Everything defaults to mock/local/inline, so the app boots with **zero
external services** and is fully deterministic — the seeded dataset, unit,
API, and e2e tests all rely on this.

## Local speech-to-text (Whisper large-v3-turbo)

Audio and video sources are transcribed offline by a local
[Speaches](https://speaches.ai) server (faster-whisper) that exposes the
OpenAI-compatible `/v1/audio/transcriptions` endpoint, so no code change is
needed. Start it once, with GPU support (CPU works too, slower):

```bash
docker run --detach --name speaches --publish 8000:8000 --gpus=all \
  --env WHISPER__COMPUTE_TYPE=int8 --env STT_MODEL_TTL=-1 \
  --volume hf-hub-cache:/home/ubuntu/.cache/huggingface/hub \
  ghcr.io/speaches-ai/speaches:0.8.3-cuda
curl -X POST http://localhost:8000/v1/models/deepdml/faster-whisper-large-v3-turbo-ct2
```

Then in `.env`:

```
TRANSCRIPTION_PROVIDER="whisper"
WHISPER_BASE_URL="http://localhost:8000/v1"
WHISPER_MODEL="deepdml/faster-whisper-large-v3-turbo-ct2"
WHISPER_TIMEOUT_MS="3600000"
```

- `int8` is the right compute type for older GPUs such as the GTX 1080 Ti
  (Pascal has no fast float16). Measured there: about 5x real time, so a
  90-minute lecture takes about 20 minutes; `WHISPER_TIMEOUT_MS` must cover it,
  because the whole lecture is one request and it is never retried.
- The model returns `verbose_json` segments with start/end timestamps; they
  become the transcript segments and the citation anchors (seek-to-time).
- Whisper has no speaker diarization; a warning is stored when it is requested.
- Existing sources keep their old transcript until you use **Import again** on
  them (Sources page), then regenerate the study material.

## Database workflow

- Schema changes: edit `prisma/schema.prisma` → `npm run db:push` (or
  `npm run db:setup` when the change touches the vector column/index).
- `prisma/seed.ts` is idempotent-ish but designed for a fresh DB; it creates
  the demo user, a fully-processed study set (video + slides + notes →
  transcript, chunks with embeddings, guide, FSRS deck with due cards,
  8-question quiz, exercises, tutor history) and a second study set that is
  mid-ingestion (live job state on the dashboard).
- `scripts/verify-seed.mjs` prints counts (sources, chunks, embeddings, due
  cards, running jobs) — handy after re-seeding.

## Testing

| Layer | Command | Notes |
|---|---|---|
| Unit | `npm run test` | Pure logic: FSRS/SM-2, chunking, validation rules, citations, rate limiting — no DB |
| API | `npm run test:api` | Route handlers hit a real (dev) database; `getServerSession` is mocked; each test creates and disposes its own user |
| E2E | `npm run test:e2e` | Playwright against a seeded DB; starts/reuses the dev server |

E2E notes learned the hard way (Windows dev box):

- The suite runs **one worker** on purpose: parallel browsers against a dev
  server turn first-visit route compilation into flakes. Timeouts are
  generous (`expect` 10 s, navigation 30 s) for the same reason.
- A killed dev-server *task* can leave an orphaned node process holding
  port 3000 in a broken state; Playwright's `reuseExistingServer` will then
  happily reuse the zombie. If everything fails at once:
  `Get-NetTCPConnection -LocalPort 3000 -State Listen` and kill the stale
  PID before restarting.
- `signInAsDemo` signs in via `page.request` (csrf fetch + credentials
  POST sharing the browser cookie jar), not by driving the form — the
  dev-mode next-auth csrf race could bounce even a *successful* form
  submission, reliably so on non-default ports.
- If the dev server runs on another port (say a second project holds
  3000), point the suite at it: `$env:E2E_BASE_URL="http://localhost:3001";
  npm run test:e2e` — and start that server with matching
  `NEXTAUTH_URL`/`APP_URL` env overrides.

## Code conventions

- **API routes**: `apiHandler` + `requireSession` + `parseJsonBody(zodSchema)`
  + `assertStudySetAccess`; return `ok(...)`; throw the helpers from
  `src/lib/api.ts` (`badRequest`, `notFound`, ...) for errors.
- **Zod schemas** are the wire contract; the generic-response pattern uses
  `<S extends ZodTypeAny>` + `z.output<S>` for inference.
- **Generated content** must carry `claimType` + citation anchors; run
  drafts through `pipelines/validation.ts` before persisting.
- Timestamps for citations: `formatTimestamp(ms, forceHours, withMs)` — wire
  format is `hh:mm:ss.mmm` (`00:12:41.000`).
- React Query for all client fetching (`src/hooks/use-api.ts` — one hook
  per route, query keys centralised in `qk`).
- Never put provider keys in client code; env access goes through
  `src/lib/env.ts` (Zod-validated, lazy).

## Local HTTPS (optional)

`npm run dev:https` serves the app on `https://localhost:<port>` with a
locally trusted certificate from [mkcert](https://github.com/FiloSottile/mkcert)
v1.4.4 (kept in the git-ignored `.tools/mkcert/`; certificates in the
git-ignored `certificates/`). One-time setup, run by **you** in PowerShell
from the project folder — it adds a root CA to your *Current User* trust store
(Windows asks for confirmation; no admin rights):

```powershell
.\.tools\mkcert\mkcert.exe -install
.\.tools\mkcert\mkcert.exe -cert-file certificates\localhost.pem -key-file certificates\localhost-key.pem localhost 127.0.0.1 ::1
```

Then start with matching URLs (cookies become `Secure`):

```powershell
$env:NEXTAUTH_URL="https://localhost:3001"; $env:APP_URL="https://localhost:3001"
npm run dev:https -- -p 3001
```

E2E: `$env:E2E_BASE_URL="https://localhost:3001"; npm run test:e2e` (the config
starts `dev:https` for an https base URL). Notes: Git-for-Windows `curl` uses
Schannel and fails mkcert certificates on revocation lookup — add
`--ssl-no-revoke`; the CA's private key lives in `%LOCALAPPDATA%\mkcert`
(never share it); undo everything with `.\.tools\mkcert\mkcert.exe -uninstall`.

## Troubleshooting

- **`Unknown argument <field>` from `prisma.….create()` after a schema change** —
  the running server holds a stale Prisma client. On Windows a running Node
  process locks the query-engine file, so `prisma generate` run *while the dev
  server is up* only half-updates the client (look for
  `node_modules/.prisma/client/query_engine-*.tmp*`). Stop the dev server,
  run `npx prisma generate`, start it again. `npm run dev` now regenerates the
  client automatically (`predev`), so restarting through it is enough.

- **`P1014`/missing tables on `db push`** — wrong Postgres server; see
  [Postgres on port 5433](#postgres-on-port-5433).
- **Redis container won't start ("port already allocated")** — something
  (often WSL) holds 6379. Fine to ignore in mock mode (`QUEUE_DRIVER=inline`);
  otherwise stop the other service or change the mapping.
- **E2E everything-fails** — check for an orphaned server on 3000 (above).
- **`.next` corrupted after a crash** (`TS6053 … .next/types not found`,
  `Unexpected end of JSON input` in static-path generation) — stop the dev
  server, delete `.next`, restart; type files regenerate on first compile.
