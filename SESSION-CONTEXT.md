# LectureForge — Session Context & Handoff

_Last updated: 2026-10-14. Read this before resuming work; it captures everything not
recorded in the code or the other docs (README / ARCHITECTURE / DEVELOPMENT / DEPLOYMENT)._

## 1. What this project is

**LectureForge** — an AI-native study web app (Next.js 14 App Router + TS + Tailwind +
shadcn/ui + React Query, Prisma/PostgreSQL+pgvector, Auth.js, BullMQ-or-inline queue,
model-agnostic AI layer, fully mockable providers). Students convert their own lecture
materials (video/audio/PDF/slides/notes/YouTube) into source-linked transcripts, study
guides, FSRS flashcards, adaptive quizzes, exercises, and a grounded Socratic tutor.
Core principles: every claim cites its source chunk; invented material is labeled;
editing is first-class; privacy by default; hints before solutions.

**Status: feature-complete for the original spec. All 10 deliverables done and verified.**

## 2. Verification state (as of last session)

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | 0 warnings/errors |
| `npm run build` | passes (last verified before the recovery work; re-run only with dev server stopped) |
| Unit tests (`npm run test`) | **82 passed** (incl. 9 new `queue-recovery` tests) |
| API tests (`npm run test:api`) | 16 passed |
| E2E (`npm run test:e2e`) | **10/10** on port 3001 (2026-10-14, after orphan-recovery + Playwright port fix) |

E2E on a non-default port requires: `$env:E2E_BASE_URL="http://localhost:3001"; npm run test:e2e`
and the server must be running with matching `NEXTAUTH_URL`/`APP_URL` (see §5).

## 3. Work completed across sessions (most recent last)

1. Full app implementation + seed (demo ML lecture set + mid-ingestion GNN set), tests, docs.
2. E2e-driven bug fixes: detail API missing `counts` (page crash); quiz submit nested
   `answer` key stripped by zod (everything graded 0); exercise submit sent `{attempt}`
   instead of `{submission}` (400s); four indistinguishable "Open" links (aria-labels).
3. **Upload ticket origin fix** — `LocalStorage` built upload/read URLs from
   `APP_URL ?? http://localhost:3000`; serving on 3001 handed the browser a PUT URL
   pointing at the *other* project's server, so uploads hung forever. Tickets and read
   URLs now derive from `new URL(req.url).origin` (passed by the three call sites);
   `APP_URL` is only a fallback. S3 driver ignores the param (presigned URLs).
4. **Processing status bar (latest feature)** — sources page + study-set overview strip
   show a live stepper: **Uploading → Extracting text → Chunking → Vectorizing →
   Indexing** (order: embeddings are computed per chunk, so chunking precedes
   vectorizing). A/V stages (probing/extracting-audio/transcribing/…) map onto
   "Extracting text". Failed sources mark the phase where they died + error text.
   - New files: `src/lib/pipeline-phases.ts` (pure mapping — unit-tested),
     `src/components/shared/pipeline-status.tsx` (the bar, a11y: role=status +
     aria-label "Processing: <phase> — <pct>%").
   - `indexChunks` now emits distinct `vectorizing` (embed) and `indexing` (pgvector
     write) stages via an `onStage` callback; vectors matched to rows by **ordinal**
     (createManyAndReturn order is not guaranteed).
   - `useStudySet` polls every 2s while jobs are active **or** any source is
     PENDING_UPLOAD/PROCESSING (previously stopped polling during upload — no job row
     exists yet at that point).
5. **Inline-queue finalization bug** — enqueue call sites pass `generationJobId` in the
   *payload*, but the inline driver guarded its RUNNING/SUCCEEDED updates on
   `opts.generationJobId` only → finished ingest jobs stayed `QUEUED` forever (misleading
   dashboard + endless client polling). Redis path had the same flaw (spread overwrote
   the payload id with undefined). Both fixed via `opts.generationJobId ?? payload id`;
   verified live: job reaches SUCCEEDED with finishedAt.
6. **E2E sign-in hardened** — next-auth dev csrf race bounced even *successful* form
   sign-ins (reliably on port 3001). `signInAsDemo` now signs in via `page.request`
   (csrf GET + credentials POST sharing the browser cookie jar) — deterministic.
7. **Orphaned-job recovery (inline driver)** — a server restart mid-job left rows
   QUEUED/RUNNING forever (the reported "Quantitative Analysis stuck at 0%" was two such
   orphans: the inline driver has no persistence, and `maybeAutoGenerate` had queued
   GENERATE_GUIDE/GENERATE_FLASHCARDS for a source later deleted). New
   `src/lib/queue/recovery.ts`: `ensureRecovered()` runs once per process, called
   fire-and-forget from both study-set GET routes (an `instrumentation.ts` hook was
   abandoned — that layer cannot bundle node builtins). It re-enqueues stale
   (>60 s untouched) orphans, phases **ingests before generation** (generation searches
   the ingests' indexed chunks), bounds by `attempts/maxAttempts`, and skips rows with
   `payload.demoFrozen === true` (the seed's deliberately mid-ingestion GNN job; seed +
   live row patched). `enqueue` now returns `{ driver, done }` so recovery can await
   completion. Verified live: orphans re-ran and failed with a truthful error; polling
   stopped. Unit-tested in `tests/unit/queue-recovery.test.ts` (`planRecovery` is pure).
8. **Truthful empty-retrieval errors** — with mock bag-of-words embeddings, a set whose
   title/subject shares no vocabulary with its (foreign-language) sources matches
   nothing above `minScore`. `emptyRetrievalError(studySetId)` (in `src/lib/retrieval`)
   now distinguishes "0 indexed chunks" from "matched none of N" with an actionable
   message; guide/quiz/flashcards/exercises pipelines throw it instead of the misleading
   "No indexed sources yet".
9. **Playwright port mismatch corrupted `.next`** — `webServer.url` was hardcoded to
   3000 while tests ran on `E2E_BASE_URL` (3001); the probe found 3000 dead and spawned
   a *second* `next dev` sharing the same `.next`, and the two racing dev servers
   corrupted the incremental build (every request served
   "missing required error components" HTML → all sign-ins failed). Config now derives
   `url` and `command`'s `-p` from the same `baseURL`. Also: the flashcard E2E regex
   needed the `i` flag (UI renders "Session complete"); repeated runs consume due
   cards, so the demo deck's due dates were reset in-DB to the seeded distribution.

## 4. Environment quirks (Windows box — all of these bit us)

- **Postgres on host port 5433**, not 5432: WSL's `wslrelay.exe` binds `127.0.0.1:5432`
  specifically and silently beats Docker's `0.0.0.0` publish. Container:
  `curiosity-glm-db-1` (`pgvector/pgvector:pg16`).
  `DATABASE_URL=postgresql://lectureforge:lectureforge@localhost:5433/lectureforge?schema=public`
- **Port 3000 is occupied by the OTHER project** (`F:\Curiosity` — "Curiosity", its node
  dev server + its containers `curiosity-postgres-1`/`curiosity-redis-1`/
  `curiosity-storage-1`). LectureForge therefore runs on **3001**. Those containers are
  the main memory hogs; the system's memory-pressure reaper has killed our background
  dev server twice because of them. If Curiosity isn't active, stopping its server +
  containers fixes the reaping.
- **Zombie dev server**: stopping a dev-server *task* can orphan its node child holding
  the port in a broken state; Playwright's `reuseExistingServer` then reuses the zombie
  and everything fails. Check `Get-NetTCPConnection -LocalPort <port> -State Listen`,
  kill the stale PID, restart.
- **Never run `npm run build` while a dev server is live** — `next build` overwrites
  `.next` underneath it; document requests still 200 from compile cache but chunk
  requests hang → every Playwright `load` times out. Fix: kill server, delete `.next`,
  restart. (Any second dev process on the same `.next` does the same — see §3.9; symptom:
  every request returns the "missing required error components" HTML, curl included.)
- Prisma quoted camelCase columns (`"dueAt"`, `"studySetId"`, …) inside snake_case
  `@@map` tables — psql SQL must quote them.
- Dev server on 3001 **must** be started with `$env:NEXTAUTH_URL="http://localhost:3001"`
  (and `APP_URL` same) or sign-in sessions bounce (csrf mismatch).
- Prisma tables use snake_case `@@map` (`sources`, `generation_jobs`, …) — not `"Source"`.
- PowerShell paths with `[studySetId]` need `-LiteralPath`; quoting SQL through
  `docker exec` is easiest from Git Bash with single quotes.

## 5. Runbook

```powershell
# Dev server (port 3001; 3000 belongs to Curiosity)
$env:QUEUE_DRIVER="inline"; $env:AI_PROVIDER="mock"; $env:STORAGE_DRIVER="local"
$env:TRANSCRIPTION_PROVIDER="mock"
$env:NEXTAUTH_URL="http://localhost:3001"; $env:APP_URL="http://localhost:3001"
npm run dev -- -p 3001

# DB (idempotent; do once after cloning or schema changes)
docker compose up -d db
npm run db:setup ; npm run db:seed
node scripts/verify-seed.mjs   # sanity-check seeded counts

# Tests
npm run test                                   # unit (82)
npm run test:api                               # API (16) — needs dev DB
$env:E2E_BASE_URL="http://localhost:3001"; npm run test:e2e   # 10, serial worker
# (E2E consumes one due flashcard per run; when the demo deck runs dry, reset dueAt
#  per the seed offsets — see §8.)
```

Demo login: **demo@lectureforge.app / demo-password** (seeded; do NOT seed production).
Everything runs in mock mode with zero external services; swap providers via `.env`.

## 6. Deliberately NOT done (do only if asked)

- ~~No git repo / commits yet~~ — repo initialized 2026-10-14 (root commit `691d0f6`
  on `main`, everything except `.env`/build output via `.gitignore`). No remote yet;
  commit messages must end with
  `Co-Authored-By: Claude Code <noreply@anthropic.com>` (same for PR descriptions with
  the 🤖 Generated with Claude Code line).
- Curiosity's server/containers left running (not ours to kill without asking).
- `.env` still says `APP_URL=http://localhost:3000` — intentional: code now derives
  URLs from request origin, so the file documents the *default* port; don't "fix" it to
  3001 or it breaks again when the app returns to 3000.

## 7. Where things live (beyond the obvious)

| Concern | Path |
|---|---|
| Phase mapping for the status bar | `src/lib/pipeline-phases.ts` (+ `tests/unit/pipeline-phases.test.ts`) |
| Status bar UI | `src/components/shared/pipeline-status.tsx` |
| Ingest pipeline + stage calls | `src/lib/pipelines/ingest.ts` |
| Embedding/index split | `src/lib/retrieval/index.ts` (`indexChunks`, `onStage`) |
| Queue facade + inline driver | `src/lib/queue/index.ts` (job-id resolution fix) |
| Upload tickets (origin fix) | `src/lib/storage/local.ts` + 3 call sites in `src/app/api/study-sets/**` |
| E2E helpers (request-based sign-in) | `tests/e2e/helpers.ts` |
| Windows/port gotchas | DEVELOPMENT.md ("Postgres on port 5433", testing, troubleshooting) |
| Deployment (Vercel/Neon/Upstash/worker) | DEPLOYMENT.md |

## 8. Known minor items / next candidates

- E2E flake (seen once): clicking a tool-card "open X" link during a detail-page
  re-render can miss navigation; passed on retry. A retry-able click in
  `openSeededStudySet` would harden it if it recurs.
- The old mystery client (a stale browser tab from the Curiosity project) periodically
  polls `/api/study-sets/<id>/status` — harmless, disappears when that tab closes.
- A user-created account + study set (`cmv7ztgpk…`, "Electronics_Review.pdf" was its
  upload) exist in the dev DB from live testing; the stuck PENDING_UPLOAD row was
  cleaned up. Safe to wipe via re-seed if a clean demo DB is wanted.
- Dev-DB residue from the recovery work (2026-10-14): the "Quantitative Analysis" set
  (`cmv7bm88…`) has 0 sources and its two rescued jobs now show truthful FAILED errors
  (its source was deleted before the bug fix); "Electronics_Review" guide/deck rows are
  FAILED from live-testing the new message (French metadata vs English PDF scores ~0
  under mock embeddings). Both are demo-only; re-seed or delete freely.
- E2E state drift: each run grades one due card "Good", shrinking the seeded deck's due
  queue (12 cards, offsets `[+1d, -1d, +3d, -2d, -1h×6, +6d, -3d]` by creation order).
  The test accepts both "2 / N" and "Session complete", but when the queue empties the
  "review N due" step fails — reset `dueAt`/`suspended` per those offsets in SQL.
- Optional hardening: a global-setup that re-seeds (or resets due cards) before E2E
  would remove the drift item above entirely.
