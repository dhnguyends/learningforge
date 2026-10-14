# LearningForge

Turn your course materials into study tools that stay honest about where every
claim comes from. Upload lecture recordings, conference videos, PDFs, slide
decks, handwritten notes, or paste a YouTube link you have rights to —
LearningForge transcribes, indexes, and generates **source-linked study guides,
spaced-repetition flashcards, adaptive quizzes, and advanced exercises**, plus
a Socratic tutor that cites your materials and gives hints before solutions.

Built for university students in technical fields: equations, code, units, and
definitions are preserved and rendered properly, not flattened into prose.

## Why it's different

- **Source-grounded by default.** Every generated claim links to the exact
  source chunk — a timestamp range for audio/video, a page+region for
  documents, a file+region for notes and images. Click any citation to jump
  back to the original moment.
- **Honest labeling.** Content is marked `Supported by source`,
  `Inference / synthesis`, or `Additional practice, not stated in source`.
  Invented material is never presented as source-derived.
- **Editing is first-class.** Guides, cards, and quizzes are editable,
  versioned, exportable, and regenerable with constraints ("shorter",
  "more equations", "skip lecture 3").
- **Active learning.** FSRS-4.5 spaced repetition, server-graded quizzes with
  distractor rationales, multi-step exercises with rubric feedback, and a
  tutor that scaffolds instead of solving.
- **Your content stays yours.** Private-by-default study sets, one-click
  export and deletion, explicit consent before any recording or YouTube link
  is processed, and no model training on your content.

## Stack

Next.js 14 (App Router) · TypeScript · Tailwind CSS + shadcn/ui · React Query ·
Prisma + PostgreSQL (pgvector) · Auth.js (NextAuth) · BullMQ + Redis · FFmpeg ·
S3-compatible storage · Vitest + Playwright

The AI layer is model-agnostic: OpenAI-compatible, Anthropic-compatible, or a
local Ollama-style endpoint — plus a deterministic **mock provider** so the
whole product runs offline for development and tests.

## Quickstart

```bash
npm install
docker compose up -d db        # Postgres 16 + pgvector on host port 5433
cp .env.example .env           # defaults run fully in mock mode
npm run db:setup               # CREATE EXTENSION vector + db push + HNSW index
npm run db:seed                # demo data: an advanced ML lecture, fully processed
npm run dev                    # http://localhost:3000
```

Sign in as **demo@learningforge.app / demo-password** — the seeded
"Backpropagation & Optimization" study set has a processed lecture video,
slide deck, recitation notes, a study guide, a 9-card FSRS deck with due
cards, an 8-question quiz, exercises, and tutor history.

> **Port note:** Postgres publishes on host port **5433**, not 5432, so a
> native or WSL Postgres on `127.0.0.1:5432` can't shadow the container.
> See [DEVELOPMENT.md](DEVELOPMENT.md#postgres-port-5433) for the full story.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run build` / `npm start` | Production build / serve |
| `npm run worker` | Background worker (BullMQ consumer, watch mode) |
| `npm run worker:once` | Background worker, single run (production) |
| `npm run db:setup` | Enable pgvector, push schema, create HNSW index |
| `npm run db:seed` | Seed demo study set + demo account |
| `npm run db:studio` | Prisma Studio |
| `npm run typecheck` / `npm run lint` | Types / ESLint |
| `npm run test` | Unit tests (Vitest) |
| `npm run test:api` | API route tests against the dev database |
| `npm run test:e2e` | Playwright end-to-end suite (needs seeded DB) |

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — system design, data model, pipelines,
  jobs, grounding & citation machinery
- [DEVELOPMENT.md](DEVELOPMENT.md) — local setup deep dive, environment
  variables, testing, troubleshooting (incl. the 5433 port story)
- [DEPLOYMENT.md](DEPLOYMENT.md) — deploying to Vercel + Neon + Upstash + S3
  with a separate worker process

## Access & accounts (invite-only)

- **Access key** — set `LECTURE_ACCESS_KEY` in `.env` and every page and API
  requires it: visitors enter it once at `/access` (30-day signed cookie;
  changing the key locks everyone out). Leave it empty to disable the gate.
- **No self-registration** — accounts are created by administrators at
  **`/admin`** (create, edit name/email/password/role, delete).
- **First administrator** — `ADMIN_PASSWORD='…' npx tsx scripts/create-admin.ts you@example.com "Your Name"`
  (or, for an existing account, `npx tsx scripts/create-admin.ts you@example.com` to promote it).

## Privacy & integrity guarantees

- Users confirm they have the rights to upload/process a recording before any
  media job starts (`rightsConfirmed`, timestamped).
- Study sets are workspace-private; nothing is shared by default.
- `GET /api/account/export` returns the user's full data; `DELETE
  /api/account` purges stored objects then cascades every row.
- The tutor reveals full solutions only through an explicit, audited
  `POST /api/exercises/[id]/solution` confirmation — never implicitly.
- No model training on private content; provider keys live only in
  server-side secrets, never in the client.
