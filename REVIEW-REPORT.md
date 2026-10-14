# LearningForge — Architecture & Robustness Review

_Reviewer: lead architect review (Claude Code) · Date: 2026-10-14 · Commit reviewed: `0de1a5c` (main, clean tree)_
_Audience: the development team / AI code assistant that will implement the fixes._

---

## 1. Executive summary

LearningForge is well structured for an early-stage product. It has a clean provider abstraction (AI, embeddings, transcription, storage, queue), Zod validation at every API boundary, a server-authoritative quiz grader, citation anchors built into the data model, and a fully offline mock mode. Typecheck and lint are clean and **all 108 automated tests pass**.

**The green suite hides real defects.** The tests cover happy paths with the seeded demo account. Nothing tests tenant isolation, the upload/file-serving layer, editing, regeneration, or failure paths. Live probes against the running app confirmed:

- **4 cross-tenant security holes** in the storage layer: any signed-in user can **read and overwrite other users' files**.
- **An SSRF vector** through the YouTube import.
- **Privacy guarantees that don't hold.** Extracted and YouTube audio is never deleted.
- **Two core editing features that corrupt or reject user data.** Selective regeneration duplicates the guide, and a second flashcard edit fails with 500.

**Verdict: not production-ready.** The architecture is sound and most fixes are local. The S-class items must be fixed before any multi-user or public deployment.

| Severity | Count |
|---|---|
| 🔴 Serious | 9 |
| 🟠 Normal | 17 |
| 🟢 Low | 14 |

### Fix status (updated 2026-10-14)

| ID | Status | Change |
|---|---|---|
| S1 | ✅ Fixed | `src/lib/storage/tickets.ts`: HMAC-signed, expiring upload tickets bound to key, user, content type and size. `/api/dev/uploads` verifies the ticket, only accepts PUTs while the source is `PENDING_UPLOAD` (409 afterwards), checks Content-Type (415), and streams to disk with a size cutoff (413). |
| S2 | ✅ Fixed | `/api/files` authorizes on `parseTenantKey()` of the exact key it serves: safe segments only (400 on `..`), study-set read access, and the study set must belong to the key's workspace. `localStoragePath()` enforces `root + sep`. |
| S3 | ✅ Fixed | `src/lib/storage/keys.ts`: keys are built from server ids only (`…/sources/<id>/original.<ext from MIME>`); the client filename is display metadata. `assertSafeKey()` runs in both drivers. `uploads/complete` refuses keys outside the source prefix. |
| S5 | ✅ Fixed | Extracted, YouTube and recap audio are written under the tenant prefix (`sourceDerivedKey`, `studySetRecapKey`). `scripts/migrate-storage-keys.ts` (dry run by default, `--apply`) moves legacy objects and resets sources whose original key escaped its prefix. It has been applied to the dev DB. |

Regression suite: `tests/api/security/storage-isolation.test.ts` (31 tests). 18 of them fail on the pre-fix code and all pass after the fix. The live probes for S1/S2/S3/S5 now return 403/400 with no leak, and YouTube playback returns 200.

---

## 2. Test execution results

Environment: Windows 11, Node 25.2.1, Postgres 16 + pgvector (`curiosity-glm-db-1`, port 5433), dev server on port 3001, all providers mocked (`QUEUE_DRIVER=inline`, `AI_PROVIDER=mock`, `STORAGE_DRIVER=local`, `TRANSCRIPTION_PROVIDER=mock`).

| Stage | Command | Result |
|---|---|---|
| Static: types | `npm run typecheck` | ✅ clean |
| Static: lint | `npm run lint` | ✅ 0 warnings / errors |
| Unit | `npm run test` | ✅ **82 / 82** passed (7 files, ~32 s) |
| Integration (API + DB) | `npm run test:api` | ✅ **16 / 16** passed (2 files) |
| End-to-end (Playwright) | `E2E_BASE_URL=http://localhost:3001 npm run test:e2e` | ✅ **10 / 10** passed (2.6 min) |
| **Live adversarial probes** (added by this review) | scripted HTTP probes, 2 throwaway local accounts | ❌ **15 defects confirmed**, 3 not reproduced |

Probe results:

| # | Probe | Outcome |
|---|---|---|
| P1 | `GET /create` unauthenticated | **200**: page not covered by middleware |
| P2 | Register with an existing email | **400 "already exists"**: account enumeration |
| P3 | 3 concurrent registers with the same email | 201, 400, 400: handled (not a bug) |
| P4 | Call `/api/uploads/complete` twice | **2 INGEST jobs** for one source |
| P5 | User B creates a source whose filename is `../../../../../<wsA>/…/secret.txt`, then completes | **A's secret file ingested into B's study set** and visible in B's export |
| P6 | User B `PUT /api/dev/uploads/<A's key>` | **200, A's file overwritten** |
| P7 | User B `GET /api/files/workspaces/<wsB>/..%2F<wsA>/…` | **200, A's file content returned** |
| P8 | `Range: bytes=10-5` | **500** |
| P9 | `Range: bytes=-5` | Returns `bytes 0-5` (head, not tail) |
| P10 | Edit the same flashcard twice | 1st 200, **2nd 500** |
| P11 | Regenerate ONE guide section | **Guide grew from 4 to 7 sections** |
| P12 | Quiz generation on a set with no sources | Job FAILED, **Quiz.status stuck QUEUED** |
| P13 | Hit the generation rate limit | 429 after the limit, but **an orphan Quiz row was created anyway**; `Retry-After` is always 60 |
| P14 | YouTube source with `https://attacker.example/x?youtube.com/watch?v=AAAAAAAAAAA` | **201 accepted; yt-dlp made an outbound request to attacker.example** |
| P15 | Study set with 1 valid and 1 invalid source | **400 returned, but the set and first source were persisted** |
| P16 | Password reset | Stub: `{"delivery":"unconfigured"}`, no reset possible |
| P17 | 15 wrong passwords, then the right one | No throttling or lockout |
| P18 | Play back a READY YouTube source | **403**: audio key is outside the `workspaces/` prefix |

Test data created by the probes is still in the dev DB and `.data/storage`: users `probe-a-1792007127783@example.test` and `probe-b-…@example.test`, their study sets, and one downloaded YouTube audio file. Remove it with a re-seed or by deleting those users.

---

## 3. Findings

Severity definitions:
- **Serious:** security or tenant-isolation breach, data loss or corruption, a broken privacy guarantee, or a core feature that is unusable.
- **Normal:** incorrect behaviour or robustness gap with a workaround or limited blast radius.
- **Low:** hygiene, performance, or a latent issue.

### 🔴 Serious

**S1 — Cross-tenant file overwrite through the local upload endpoint** *(confirmed P6)*
`src/app/api/dev/uploads/[...key]/route.ts:12-31` accepts a PUT to **any** key from any signed-in user. It does not check workspace membership, ticket signature, expiry, or that the key belongs to a PENDING_UPLOAD source. It also buffers the whole body (`:28`) with no size cap. The route only checks `STORAGE_DRIVER === "local"`, never `NODE_ENV`, and `local` is the default driver.
→ Fix: issue an HMAC-signed, expiring ticket (key, contentType, maxBytes, userId) in `LocalStorage.createUpload`, verify it here, enforce `Content-Length ≤ maxBytes`, and stream to disk. Refuse the route when `NODE_ENV === "production"`.

**S2 — Cross-tenant file read through `/api/files` path traversal** *(confirmed P7)*
`src/app/api/files/[...key]/route.ts:38` authorizes on `params.key[1]` (the workspace id segment). `:47` then resolves `path.join(root, key)`, which normalizes `..`. A key like `workspaces/<myWs>/..%2F<victimWs>/…` passes the membership check but serves the victim's file.
→ Fix: reject any segment that is `.`, `..`, empty, or contains `/` or `\`. Authorize on the **normalized** path, or better, look up the `SourceAsset` by `storageKey` and authorize through its study set. Use `startsWith(root + path.sep)`.

**S3 — Cross-tenant file read through an unsanitized upload filename** *(confirmed P5)*
`sourceAssetKey()` (`src/lib/storage/types.ts:33`) concatenates the client-supplied `filename` into the storage key. The source routes accept any 1–255 character string. With `../` segments the key resolves into another workspace. `/api/uploads/complete` then reads it (`src/app/api/uploads/complete/route.ts:30`) and the ingest pipeline indexes the victim's document into the attacker's study set. On S3 the key is literal, so this does not traverse, but it still creates malformed nested keys.
→ Fix: never put user input in keys. Use `…/sources/<sourceId>/original.<ext>` and keep the display filename only in the DB. Add a defensive `assertSafeKey()` in both storage drivers.

**S4 — SSRF through the YouTube import** *(confirmed P14)*
`parseYouTubeId` (`src/lib/media/ffmpeg.ts:139`) is an unanchored regex. It matches `youtube.com/watch?v=…` anywhere in the string, including a query string on another host. The **original URL** is then passed to `yt-dlp` (`:107`), whose generic extractor fetches arbitrary hosts. That includes internal services and cloud metadata endpoints reachable from the worker.
→ Fix: parse with `new URL()`, allowlist hostnames (`youtube.com`, `www.youtube.com`, `m.youtube.com`, `youtu.be`), extract the id, and pass yt-dlp a **canonical** `https://www.youtube.com/watch?v=<id>`. Also add `--no-playlist`, `--max-filesize`, a timeout, and `--` before the URL.

**S5 — Extracted and YouTube audio is stored outside the tenant prefix: never deleted, and not playable** *(confirmed P18)*
`src/lib/pipelines/ingest.ts:65` and `:98` write `${source.id}/audio.mp3` instead of `workspaces/<ws>/study-sets/<set>/sources/<id>/…`. As a result:
- (a) Source, study-set and account deletion (`deletePrefix("workspaces/…")`) never removes these recordings. This breaks the README guarantee that deletion purges stored objects.
- (b) `/api/files` derives the workspace from `key[1]`, so YouTube playback returns 403.

→ Fix: build every derived key with a single helper under the source prefix. Add a one-off migration that moves existing objects and updates `source_assets.storageKey`.

**S6 — Whole-file buffering of uploads up to 2 GB in the web process**
Every layer loads the full object into memory:
- `uploads/complete` reads the whole object just to verify its size.
- The dev PUT buffers the whole body.
- `/api/files` (non-range) calls `Buffer.alloc(size)` (`:89`).
- Ingest reads the original, writes it to a temp file, then reads the audio back.

With `MAX_VIDEO_BYTES = 2 GB` and the inline queue running inside the web process, a single large upload or a full-file GET can exhaust memory or crash the server for every user.
→ Fix: use `stat`/`HeadObject` for verification, stream bodies (`fs.createReadStream` → `ReadableStream`; `pipeline` to disk), and give ffmpeg a temp file path streamed from storage.

**S7 — "Regenerate this section" regenerates and appends the whole guide** *(confirmed P10: 4 → 7 sections)*
`src/lib/pipelines/guide.ts:77-130`: with `sectionIds` set, the job still loops over **all** outline sections, creates all of them, and then deletes only the targeted section. `keptSections` (`:83`) is computed inverted: it holds the sections being replaced, not the ones being kept. Every click duplicates the guide. Full regeneration also silently deletes user-edited sections.
→ Fix: for selective regeneration, skip the outline step. Regenerate content only for the targeted section(s) and update them in place (same ordinal and parent), then bump `version`. Warn before a full regeneration overwrites `edited` sections.

**S8 — A second flashcard edit always fails (500)** *(confirmed P9)*
`src/app/api/cards/[cardId]/route.ts:30` uses `version: card.reps` for the `ArtifactEdit` snapshot. That value doesn't change between edits, so the unique constraint `(entityType, entityId, version)` rejects the second edit. "Editing is first-class" is broken for cards.
→ Fix: add a `version` column to `Flashcard` (as `StudyGuideSection` has), or compute `max(version)+1` inside a transaction. Wrap the snapshot and update in `prisma.$transaction`.

**S9 — Authentication hardening is missing**
- No throttling or lockout on credential sign-in (P17), and no rate limiting on `/api/auth/register` or `/api/auth/reset`.
- The production check only requires `NEXTAUTH_SECRET` to be **present**. The `.env.example` value `change-me-development-secret` is accepted.
- Password reset is a stub (P16), so users locked out of their account have no recovery path.

→ Fix: add a per-IP and per-account rate limit (shared store) on the auth endpoints. Require a secret of at least 32 bytes and reject the known placeholder values in production. Implement the token-based reset flow with the existing `VerificationToken` model, or remove the UI.

### 🟠 Normal

| ID | Finding | Location | Recommended fix |
|---|---|---|---|
| N1 | Failed quiz or exercise generation leaves the artifact `QUEUED` forever (P12); only the guide pipeline sets `FAILED`. The UI spins indefinitely. | `src/lib/pipelines/quiz.ts`, `exercises.ts:88` | try/catch → set status `FAILED` (mirror `guide.ts:160`). |
| N2 | Rate limit is checked **after** the Quiz/ExerciseSet/Guide row is created, so every 429 leaves an orphan row (P13). `Retry-After` is hardcoded to 60. The limiter is in-memory per process; the comment refers to a `RATE_LIMIT_REDIS_URL` that is not implemented. | `src/lib/api/generations.ts:18`, `src/lib/api.ts:35`, `src/lib/rate-limit.ts` | Check the limit before any insert, pass the computed `retryAfterSec`, and implement a Redis/Postgres backend. |
| N3 | No rate limit on LLM-backed exercise grading (`POST /api/exercises/[id]`); this is a cost-abuse vector. | `src/app/api/exercises/[exerciseId]/route.ts` | Apply `rateLimit("grading:"+userId)`. |
| N4 | `uploads/complete` is not idempotent (P4): it re-ingests a READY source and creates duplicate jobs. It never checks `status === PENDING_UPLOAD`. | `src/app/api/uploads/complete/route.ts:38` | Conditional update `where {id, status: PENDING_UPLOAD}`; return 409 otherwise. |
| N5 | Study-set creation is not atomic (P15). The 400 for an invalid 2nd source arrives after the set and the 1st source were written. | `src/app/api/study-sets/route.ts:127-147` | Validate all sources first, then write in `$transaction`. |
| N6 | Guide citations are persisted from the **outline's** `chunkIds` (`valid`), while the section's own `anchorChunkIds` are validated and then discarded (`anchors` is unused). Citations may not support the text they are attached to, which undermines the core "source-grounded" promise. | `src/lib/pipelines/guide.ts:109-112` | Persist the union of validated section anchors; base warnings on the persisted set. |
| N7 | The Anthropic schema-repair call **replaces** the user prompt with only the error note, so the model has no task context and the repair cannot succeed. The OpenAI and local providers send `"invalid"` as the prior assistant turn, so the model never sees what it produced. | `src/lib/ai/anthropic.ts:34`, `openai.ts:51`, `local.ts:47` | Send the original prompt, the previous output, and the correction note. |
| N8 | Quiz options are served in stored order. In mock mode the correct answer is always `opt1` and first. LLMs typically emit ORDERING/DERIVATION_STEPS options in the correct order, which leaks the answer. | `src/app/api/quizzes/[quizId]/route.ts:46`, `src/lib/pipelines/quiz.ts:112` | Shuffle options at generation time (persisted) or per request. |
| N9 | Regeneration and re-ingest are not transactional (`deleteMany` then sequential creates). A mid-way failure leaves partial quizzes or guides, or a source with no chunks; re-ingest nulls every `CitationAnchor.chunkId`. | quiz, guide, ingest pipelines, `retrieval/index.ts` | Build the new version, then swap in a transaction (or version rows and flip a pointer). |
| N10 | Redis queue path: `new Queue()` and a new connection on every enqueue. If `queue.add` fails, the `GenerationJob` stays QUEUED forever (recovery is a no-op for redis). The worker marks the row FAILED on each attempt while BullMQ still retries (status flaps), and the `attempts` column is never updated. | `src/lib/queue/index.ts:30`, `src/workers/index.ts` | Use a singleton queue, mark FAILED if enqueue throws, and only write FAILED when `job.attemptsMade >= opts.attempts`. |
| N11 | The inline driver runs heavy jobs (ffmpeg, LLM) unbounded in the web process. Recovery's 60 s staleness heuristic can double-execute long-running jobs when more than one process exists. | `src/lib/queue/index.ts`, `recovery.ts` | Add a concurrency semaphore and a heartbeat (`updatedAt` touch) during long stages. Document inline mode as dev-only. |
| N12 | Production config guardrails are missing. `inline` queue, `local` storage and `mock` AI are all accepted with `NODE_ENV=production`. `isMockMode()` returns true if *any* provider is mock. | `src/lib/env.ts:79` | Fail fast (or warn loudly) in production for those settings. |
| N13 | Account enumeration through `/api/auth/register` (P2), which contradicts the anti-enumeration design of `/reset`. | `src/app/api/auth/register/route.ts:18` | Return a generic response and send "account exists" by email. |
| N14 | Range handling: `end < start` causes a 500 (P8), and suffix ranges `bytes=-N` return the head (P9). | `src/app/api/files/[...key]/route.ts:62-68` | Implement RFC 7233 parsing; 416 on invalid ranges. |
| N15 | Integrity bypass: tutor `mode: "reveal_solution"` returns full answers without the audited confirmation that the README promises. The exercise grader receives the stored solution, so a prompt-injected submission can extract it. | `src/lib/pipelines/tutor.ts`, `src/app/api/exercises/[exerciseId]/route.ts:32` | Audit and confirm reveal_solution; instruct the grader never to quote the reference solution and post-filter its output. |
| N16 | Multi-user model flaws, latent today because there is no invite feature, but the roles already exist: <br>• FSRS state lives on `Flashcard`, so members share one review schedule. <br>• `StudySet.createdBy` uses `onDelete: Cascade`, so a deleted member wipes the sets they created in someone else's workspace. <br>• Account deletion purges storage for **every** workspace the user belongs to, not only the ones they own (`account/delete/route.ts:27`). | `prisma/schema.prisma`, account delete | Move scheduling to a per-user `CardState` table, use `SetNull`/reassign on creator delete, and purge only owned workspaces. |
| N17 | `maybeAutoGenerate` race: two sources finishing together can both see `readyCount > 1` (no auto-generation) or both see `guides.length === 0` (duplicates). | `src/lib/pipelines/ingest.ts` | Use an idempotency key on GenerationJob (`idempotencyKey` exists but is unused). |

### 🟢 Low

| ID | Finding |
|---|---|
| L1 | `/create` is not in the middleware matcher (P1); the comment in `src/app/(app)/layout.tsx` claims it is. The APIs are protected, so impact is cosmetic. |
| L2 | Transcript segment edits do not re-chunk or re-embed, so the tutor and generators keep citing the old text. |
| L3 | `EMBEDDINGS_DIMENSIONS` env is dead config; the column is fixed `vector(1536)` and `embeddings.ts` hardcodes 1536. |
| L4 | N+1 queries: one UPDATE per chunk embedding, one `source.findUnique` per anchor (`anchors.ts`), sequential per-question writes in quiz attempts. Use batched SQL and `createMany`. |
| L5 | `CitationAnchor` rows are never garbage-collected on regeneration; the table grows without bound. |
| L6 | `source.durationSec ?? fallback` in ingest is dead code (`durationSec` is always a number). |
| L7 | SHORT_ANSWER grading accepts any response that *contains* the target (> 8 chars), so answer stuffing passes. |
| L8 | Password-reset audit rows store raw emails for non-existent accounts (PII), with no rate limit. |
| L9 | `PATCH /study-sets/:id` accepts `settings: z.record(z.unknown())`, which is unbounded and unvalidated, while `POST` uses a strict schema. |
| L10 | Uploaded content is never sniffed. The declared MIME type is trusted and the PUT `Content-Type` is not checked against it. |
| L11 | Concurrent section edits can collide on `ArtifactEdit` `(entityType, entityId, version)`, causing a 500. |
| L12 | E2E mutates the seeded DB (consumes due cards) and depends on manual resets. There is no global setup or reset. |
| L13 | No CI pipeline config in the repo; the green state is only asserted in `SESSION-CONTEXT.md`. |
| L14 | Doc drift: `SESSION-CONTEXT.md` cites root commit `691d0f6` (actual `0de1a5c`); layout comment versus middleware (see L1). |

---

## 4. Robustness assessment by area

| Area | Rating | Notes |
|---|---|---|
| Architecture and layering | 🟢 Good | Clear lib/route separation, swappable providers, pure functions unit-tested |
| Input validation | 🟢 Good | Zod everywhere, but storage keys and URLs need semantic validation (S3, S4) |
| AuthN | 🟠 Weak | No throttling, stub reset, enumeration |
| AuthZ / tenant isolation | 🔴 Broken | DB-level checks are consistent (`assertStudySetAccess`); the **storage layer bypasses them** (S1–S3) |
| Data integrity | 🟠 Weak | Few transactions; stuck statuses; destructive regenerations |
| Scalability / resource safety | 🔴 Poor | Full-file buffering, in-process jobs, in-memory rate limit |
| Privacy guarantees | 🔴 Not met | Orphaned audio (S5), multi-member deletion semantics (N16) |
| AI layer | 🟠 Fair | Good trust boundary on chunk ids; repair loop broken (N7); anchors mismatch (N6) |
| Test strategy | 🟠 Fair | Good unit coverage of pure logic; no negative, security, or failure-path tests |

---

## 5. Recommendations for the development team (AI code assistant)

### Fix order (one PR per group; each PR adds regression tests that reproduce the probe)

1. **Storage security (S1, S2, S3, S5, L10).**
   - Introduce `assertSafeKey(key)` and a single key builder.
   - Remove user filenames from keys.
   - Use signed, expiring local upload tickets.
   - Authorize file reads through the `SourceAsset` row.
   - Migrate existing audio keys.
   - Tests: tenant B cannot PUT or GET tenant A's keys (including `..`, `%2e%2e`, `..%2F`), traversal filenames are rejected, and deletion removes derived audio.
2. **SSRF (S4).** Hostname allowlist plus a canonical URL for yt-dlp, with a unit test table of hostile URLs.
3. **Memory safety (S6).** Streaming end-to-end. Add an API test with a 50 MB object asserting RSS stays bounded, or at least that the code uses streams/`stat`.
4. **Editing correctness (S7, S8, L11).** In-place selective regeneration, version columns, transactional snapshots. Tests: regenerate one section and the count is unchanged; edit a card 3× and get 3 snapshots.
5. **Auth hardening (S9, N13).** Shared-store rate limiter (also fixes N2/N3), secret strength check, real reset flow.
6. **Job lifecycle (N1, N2, N4, N9, N10, N11, N17).**
   - Every pipeline must end in READY or FAILED.
   - Rate-limit before insert.
   - Idempotent complete.
   - Transactional swap on regeneration.
   - Use `GenerationJob.idempotencyKey`.
7. **Grounding fidelity (N6, N7, N8, N15).** These are the product's core promise; add tests around persisted anchors versus section content.
8. **Production guardrails (N12)** and multi-user model decisions (N16) **before** shipping workspace invites.

### Engineering practices

- **Add a security test suite** (`tests/api/security/*.test.ts`) with two users and a matrix of every route × {owner, other user, anonymous}. This is the cheapest way to keep S1–S3 from regressing.
- **Test failure paths, not just happy paths.** For each pipeline, force the generator or embeddings to throw and assert the final DB state (status, partial rows).
- **Make E2E hermetic:** a Playwright `globalSetup` that re-seeds (or resets due cards) and a dedicated test database (`DATABASE_URL` for tests ≠ dev).
- **Add CI** (GitHub Actions: Postgres+pgvector service, typecheck → lint → unit → api → e2e).
- **Wrap multi-step writes in `prisma.$transaction`** by default; treat any `deleteMany` followed by creates as a code-review red flag.
- **Never derive filesystem or object paths from request input** without an allowlist-based sanitizer; prefer server-generated ids.
- **Keep `SESSION-CONTEXT.md` honest:** record test counts from CI, not by hand.

---

_Appendix: reproduction probes are in `scripts/review-probes/` (`probe.mjs`; `probe2.mjs <emailA> <emailB>` re-checks traversal with existing probe users — run with `BASE=http://localhost:3001`). They register two local throwaway accounts and exercise the endpoints listed in §2. Port them into `tests/api/security/` as the regression suite._
