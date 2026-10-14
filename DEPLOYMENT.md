# Deployment guide

LectureForge is two long-running processes plus managed infrastructure:

| Piece | Recommended | Why |
|---|---|---|
| Web (Next.js) | **Vercel** | App Router, API routes, edge middleware all first-class |
| Postgres + pgvector | **Neon** (or any managed PG with the `vector` extension) | Serverless-friendly, supports HNSW |
| Redis | **Upstash** | BullMQ queues; free tier is fine to start |
| Object storage | **S3 / Cloudflare R2 / MinIO** | Recordings, audio, parsed pages |
| Worker | **Fly.io / Render / Railway** (any always-on Node host) | BullMQ consumer (`npm run worker:once`) + FFmpeg |

FFmpeg must exist on the worker host (Fly/Render images can `apt-get install
ffmpeg`). The web process never shells out to FFmpeg.

## 1. Database

1. Create the database and note its connection string.
2. Enable the extension and push the schema:

   ```bash
   psql "$DATABASE_URL" -c "CREATE EXTENSION IF NOT EXISTS vector;"
   npx prisma db push
   ```

   `npm run db:setup` does the same plus the HNSW index — it is safe to run
   from anywhere that reaches the database.

3. **Do not seed production.** `prisma/seed.ts` creates a public demo
   account with a known password; it exists for local development only.

## 2. Storage bucket

Create a bucket (e.g. `lectureforge-prod`) with default-private ACLs and
generate access keys. Objects are keyed
`workspaces/<workspaceId>/study-sets/<studySetId>/…` so account deletion can
purge a user's prefix (`deletePrefix`) in one call. If the provider is not
S3 proper (R2, MinIO), set `S3_ENDPOINT` and make sure presigned URLs are
reachable from browsers.

## 3. Worker

On an always-on host:

```bash
npm ci --omit=dev        # or a full install if you build from source there
npm run worker:once      # under systemd / supervisor / container restart policy
```

Required env: `DATABASE_URL`, `REDIS_URL`, `QUEUE_DRIVER=redis`,
`STORAGE_DRIVER=s3` + S3 vars, plus the AI/transcription providers you use.
Scale horizontally by adding worker processes; BullMQ distributes jobs.

## 4. Vercel (web)

1. Import the repository; the build command is the default
   (`npm run build` runs `prisma generate && next build`).
2. Set the environment variables below (Production + Preview).
3. Deploy. Verify `/` renders and `/api/auth/csrf` returns a token.

### Environment variables

| Variable | Production value |
|---|---|
| `APP_URL` | `https://your-domain` |
| `DATABASE_URL` | Neon connection string (pooled endpoint) |
| `NEXTAUTH_URL` | `https://your-domain` |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` — same on every environment, **not** the dev fallback |
| `QUEUE_DRIVER` | `redis` |
| `REDIS_URL` | Upstash URL (`rediss://…`) |
| `STORAGE_DRIVER` | `s3` |
| `S3_ENDPOINT` / `S3_REGION` / `S3_BUCKET` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | your bucket |
| `SIGNED_URL_TTL` | e.g. `3600` |
| `AI_PROVIDER` | `openai` \| `anthropic` \| `local` |
| `AI_MODEL` + provider key (`OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `LOCAL_AI_BASE_URL`) | per provider |
| `EMBEDDINGS_PROVIDER` | `openai` (+ `EMBEDDINGS_MODEL`, key) — **must match the dimension of existing vectors** (1536 default) |
| `TRANSCRIPTION_PROVIDER` | `whisper` or `deepgram` (+ key) |
| `TTS_PROVIDER` | `openai` (or leave `mock` to disable audio recap) |
| `YOUTUBE_API_KEY` | optional, metadata fetch for YouTube imports |
| `GENERATION_RATE_LIMIT_PER_HOUR` | e.g. `30` |

Notes:

- The in-memory rate limiter is per-process; on Vercel's fluid compute that
  is approximately per-instance. For strict global limits, back
  `src/lib/rate-limit.ts` with Upstash Redis (drop-in: same fixed-window
  semantics).
- `QUEUE_DRIVER=inline` in production is not supported: serverless request
  scopes get killed mid-job. Always `redis` + the worker.

## 5. Post-deploy checklist

- [ ] Register a real account (email + password ≥ 8 chars) and confirm the
      workspace is created on first sign-in.
- [ ] Create a study set, upload a small PDF, and watch the job reach
      `SUCCEEDED` with guide/quiz outputs — this exercises storage, queue,
      worker, AI provider, and embeddings end to end.
- [ ] Confirm citation chips resolve (transcript timestamps for A/V, page
      numbers for documents).
- [ ] Run `GET /api/account/export` and `DELETE /api/account` on a test
      account and check the storage prefix is gone.
- [ ] Check `AuditLog` rows for consent, solution-reveal, and deletion
      events (`prisma studio` or SQL).

## Operations

- **Job failures** are written to `GenerationJob.error` and surfaced in the
  UI; triage via `select type, status, error, "createdAt" from "GenerationJob" order by "createdAt" desc limit 50;`
- **Schema migrations**: `prisma db push` is fine for solo deploys; switch
  to `prisma migrate` before multiple environments depend on one schema.
- **Scaling**: web scales on Vercel automatically; add worker replicas when
  ingest/generation queue depth grows; Postgres connection limits matter
  more than CPU (use pooled connection strings).
- **Secrets rotation**: provider keys can be rotated in the Vercel/worker
  dashboards without schema changes; `NEXTAUTH_SECRET` rotation
  invalidates sessions (users just sign in again).
