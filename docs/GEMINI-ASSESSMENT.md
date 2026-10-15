# Assessment — which Gemini model for LearningForge, and an admin AI-model selector

_Date: 2026-10-15 · Scope: report only, no code changed · Sources: Gemini API docs (models, pricing, rate limits, structured outputs), all pages last updated 2026-09 / 2026-10_

## Verdict

- **Default Gemini model: `gemini-3.8-flash`** (stable). It covers every text workload in LearningForge with the best quality-to-cost ratio:
  - JSON-schema structured output;
  - 1M-token context;
  - adjustable thinking;
  - a free tier for trying it out.
- **Cheaper alternative: `gemini-3.5-flash-lite`** (stable). Offer it in the selector for the tutor and high-volume use; quality on quiz distractors and worked exercise solutions is expected to be lower.
- **Not recommended:**
  - `gemini-4-argon`: overkill and 2.7× the price of 3.8 Flash; no free tier.
  - `gemini-3.1-pro-preview` and `gemini-3-flash-preview`: preview models only, with tighter limits and no stability promise.
  - The 2.5 family: restricted to existing users.
- **Keep EmbeddingGemma for embeddings, whichever chat model is picked.** The selector should switch only the *generation* model; switching embeddings means re-embedding every chunk and recalibrating the 0.30 relevance floor.
- **Gemini is a cloud service.** Selecting it sends lecture content to Google, which contradicts "work offline" and "your content stays yours". On the **free tier, Google uses that content to improve its products**. The selector should therefore be an explicit admin opt-in with a visible warning, and Gemma 4 should stay the default.

## 1. Candidate models (stable unless marked)

| Model | Id | Context in / out | Structured output | Thinking | Standard price per 1M tokens (in / out) | Free tier |
|---|---|---|---|---|---|---|
| Gemini 4 Argon | `gemini-4-argon` | 1M / long-decode | ✅ | ✅ | **$2.00 / $10.00** until 2026-11-30, then $4 / $20 | ❌ |
| **Gemini 3.8 Flash** | `gemini-3.8-flash` | 1,048,576 / 65,536 | ✅ | low / medium / high (`minimal` returns an error) | **$0.75 / $3.75** until 2026-12-31, then $1.50 / $7.50 | ✅ |
| Gemini 3.6 Flash | `gemini-3.6-flash` | (previous gen) | ✅ | ✅ | same as 3.8 Flash | ✅ |
| **Gemini 3.5 Flash-Lite** | `gemini-3.5-flash-lite` | 1,048,576 / 65,536 | ✅ | ✅ | **$0.30 / $2.50** | ✅ |
| Gemini 3.1 Flash-Lite | `gemini-3.1-flash-lite` | | ✅ | ✅ | $0.25 / $1.50 | ✅ |
| Gemini 3.1 Pro (preview) | `gemini-3.1-pro-preview` | | ✅ | ✅ | $2.00 / $12.00 (≤200k prompt) | ❌ |
| Gemini 3.5 Transcribe | `gemini-3.5-transcribe` | audio | n/a | n/a | ≈ **$0.005 / audio minute** | ✅ |
| Gemini Embedding 2 | `gemini-embedding-2` | multimodal | n/a | n/a | $0.20 (text) | ✅ |
| Gemma 4 (hosted on Gemini API) | — | | | | free only; *paid tier not available* | ✅ (content used to improve products) |

Pricing notes:
- Thinking tokens are billed as output.
- Batch and Flex roughly halve these prices (3.8 Flash: $0.375 / $1.875).
- Priority costs about 1.8× more.
- 3.8 Flash and Argon are on **introductory prices that double** on 2027-01-01 and 2026-12-01 respectively.

Rate limits are per project:
- **Free-tier RPM and RPD are only shown in AI Studio** for your project, not on the docs page. Expect them to be low, enough for one user testing but not for a class.
- Paid Tier 1 adds a spend cap of $10 per rolling 10 minutes.

## 2. LearningForge workloads vs models

Token estimates below come from this project's prompts and the whole-set retrieval (a typical study set is ~20–40k tokens of sources).

| Workload | What it needs | Est. tokens per call (in / out) | Best fit | Est. cost per call* |
|---|---|---|---|---|
| Study guide | long context, faithful synthesis, citations, LaTeX, strict JSON | 30k / 6k | **3.8 Flash** | ≈ $0.05 |
| Quiz | good distractors, answer justification, min/max item counts | 25k / 4k | **3.8 Flash** | ≈ $0.04 |
| Flashcards | concise, high volume, strict JSON | 25k / 3k | 3.8 Flash or 3.5 Flash-Lite | ≈ $0.035 / $0.02 |
| Exercises + worked solutions | multi-step math and reasoning | 25k / 6k | **3.8 Flash** (thinking `medium`) | ≈ $0.05 |
| Exercise feedback (grading) | compare an answer to a solution | 3k / 1k | 3.5 Flash-Lite | ≈ $0.005 |
| Tutor turn | low latency, grounded in ~8 retrieved chunks, cites chunk ids | 5k / 0.8k | 3.8 Flash (thinking `low`) or 3.5 Flash-Lite | ≈ $0.009 / $0.005 |
| Audio recap script | short prose | 6k / 1.5k | either | ≈ $0.015 |
| Transcription (still **mocked** today) | timestamps, speakers, FR/EN | per minute of audio | **3.5 Transcribe** | ≈ $0.30 per 1-hour lecture |
| Embeddings | consistent with stored vectors | — | **keep EmbeddingGemma (local)** | $0 |

\* Paid-tier standard prices at today's 3.8 Flash rate, including ~1–2k thinking tokens. **Generating all four artifacts for one study set ≈ $0.15–0.20 (≈ $0.30–0.40 from 2027).** The tutor costs fractions of a cent per question.

**Compared with local Gemma 4** (GTX 1080 Ti, measured in this project):
- Gemma takes 5–50 s per call, and quiz and exercise generation needed truncation repair. Flash-class models are typically several times faster, with larger output limits (65k tokens vs our 4,096 `LOCAL_AI_MAX_TOKENS`). *Not yet measured here; the first implementation step benchmarks both on the same study set.*
- Gemma 4 costs nothing and is fully private and offline. Gemini costs money, sends data to the cloud, and needs internet.

### Why 3.8 Flash over the others

- **vs Argon:** LearningForge's tasks are grounded summarisation and question writing over provided text, not frontier reasoning. Argon costs 2.7× more on both input and output, with no free tier to evaluate it.
- **vs 3.5 Flash-Lite:** output (the expensive part for us) is only 1.5× cheaper on Flash-Lite ($2.50 vs $3.75), but quiz and exercise quality is the product's core value. Use Flash-Lite where quality is less visible: grading, and the tutor if latency matters.
- **vs previews:** the docs advise stable model ids for production; preview models have stricter rate limits and can change or disappear.

## 3. Integration fit with the current AI layer

- `StructuredGenerator` already isolates providers (`mock`, `openai`, `anthropic`, `local`). A `GeminiGenerator` is a new ~150-line adapter.
- It would call the `generateContent` REST endpoint with `fetch`, so no new SDK dependency.
- **Structured outputs** accept a JSON-Schema subset, including `enum`, `anyOf`, `minItems` and `maxItems`, so the existing `zodToJsonSchema` output can be reused. The docs warn that "very large or deeply nested schemas may be rejected", which needs a check against the guide schema. Results still go through the same Zod validation and repair path.
- Thinking level is configurable: `low` for the tutor, `medium` for exercises. `minimal` is rejected by 3.8 Flash.
- Citations are unchanged: the model still returns chunk ids, which LearningForge validates against the retrieved set.

## 4. Admin selector

> **Status (2026-10-15): implemented.** See `src/lib/ai/gemini.ts`, `src/lib/ai/settings.ts`, `/api/admin/ai`, `/api/admin/ai/test` and `src/components/shared/ai-model-card.tsx`.
>
> Live test connections from `/admin`: `gemini-3.5-flash-lite` 0.9 s, `gemini-3.8-flash` 2.6–5.9 s, local `gemma4:latest` 45 s (cold start).
>
> `gemini-3.8-flash` briefly answered *503 "model experiencing high demand"*. The adapter now retries 429 and 503 with backoff.

The design as built:

**Behaviour.** A new "AI model" card on `/admin`:
- radio buttons: **Gemma 4 (local, private)** or **Gemini (cloud)**;
- when Gemini is selected, a model dropdown: `gemini-3.8-flash` (recommended) or `gemini-3.5-flash-lite`;
- a **Test connection** button that runs one tiny structured call and shows latency;
- a permanent warning while Gemini is active: *"Source content is sent to Google. On the free tier Google may use it to improve its products."*

**Storage.**
- New table `AppSetting { key @id, value Json, updatedAt, updatedById }` holding a single row, `ai = { provider, model }`.
- `.env` (`AI_PROVIDER`, `LOCAL_AI_*`) stays the fallback when no row exists, so tests (`AI_PROVIDER=mock`) are unaffected.

**Secret.**
- `GEMINI_API_KEY` lives **only in `.env`**: never in the database, the API or the UI.
- The card shows only "key configured ✓/✗", and the Gemini option is disabled when no key is set.

**Runtime.**
- `getGenerator()` currently caches one provider forever. Change it to a cache keyed by `{provider, model}`, resolved from the setting.
- The admin `PUT` invalidates the cache in-process, plus a 30 s re-read for a separate worker process.
- The 7 pipeline call sites (guide, quiz, flashcards, exercises, exercise-feedback, recap, tutor) need `await` added.

**Traceability.**
- Every change writes an `AuditLog` (`action: "settings.ai"`).
- The generator's `model` is already returned in `GenerationResult`; store it in the job `result` so each artifact shows which model made it.

**Out of scope:** embeddings stay EmbeddingGemma. Gemini Transcribe for real transcription is a separate, later feature, because transcription is mocked today.

**Security:**
- the settings API is protected by `requireAdmin` (DB re-check) and covered by the access gate;
- the model id is validated against an allow-list, not free text.

**Tests:**
- unit tests for settings resolution and cache invalidation;
- `GeminiGenerator` against a mocked `fetch` (schema mapping, error and timeout, invalid JSON → repair);
- admin API role checks;
- one E2E that switches the provider with the mock.

**Rollout steps:**
1. Get a Gemini API key, preferably on a paid project so content is not used for training. Put it in `.env`.
2. Implement the adapter and the settings.
3. Benchmark Gemma 4 vs 3.8 Flash on one study set (latency, JSON validity, citation correctness).
4. Enable the selector.

Estimated effort: about 1 day including tests.

## 5. Decisions needed from you

1. **Go / no-go on sending content to Google** when Gemini is selected. The alternative is keeping LearningForge fully local.
2. **Free or paid Gemini project.** On the free tier, uploaded lectures may be used by Google.
3. **Model list in the selector:** recommended `gemini-3.8-flash` + `gemini-3.5-flash-lite`.
