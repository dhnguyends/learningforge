# Audit — RAG pipeline and semantic search

_Date: 2026-10-16 · Scope: audit and proposals only, no code changed · Data: your local database (6 courses, 127 passages) and live measurements_

## Verdict

The pipeline works as designed, with sound fundamentals:
- passages are sized on target;
- every passage has an embedding from the current model;
- off-topic questions are rejected;
- French questions find French and English material;
- warm searches take about 0.1 s.

**But the content is incomplete or wrong in places, and generation sees only a fraction of each course:**
- placeholder transcripts (S1);
- 3 image-only PDFs that produced no text (S4);
- one PDF with damaged, stale passages (S5).

These problems hurt relevance far more than any search tuning would.

| # | Severity | Finding | Fix (proposed) |
|---|---|---|---|
| S1 | **Serious** | **52 placeholder ("mock") transcript passages** in 4 of your sources. In *Trading – From Basics to advanced*, 51 of its 74 passages are fake text. | Import again those 4 sources (Whisper is now active), then regenerate. Block mock transcription outside tests. |
| S2 | **Serious** | The **HNSW vector index was missing** (`prisma db push` dropped it), so every search scans all passages. | Being fixed in the Database tab work: `db:push` now keeps it, plus a Rebuild button. |
| S3 | **Serious** | **Generation sees only 22–32 % of a course.** The study guide uses 24 passages, flashcards 20 and exercises 16, out of 74. | Use **all passages when the course fits the model's context** (it does: about 25k tokens); sample only beyond that. |
| S4 | **Serious** | **3 PDFs are marked READY but have 0 passages**: *Systematic_Trading_Architecture*, *Price_Action_Playbook* and *Tactical_Day_Trading_Blueprint* (14–15 pages each). They are **image-only** (exported slides, no text layer), and PDFs have no OCR fallback, so 43 pages are invisible to search and generation. | OCR the PDF pages that have no text layer. A source that yields no text should show a "no text found" warning instead of READY. |
| S5 | **Serious** | **Stale, damaged passages in *Electronics_Review.pdf*** (Schmémas électronique): 5 passages of 897–1,041 tokens (cap 480) in which **every "s" is missing** ("Ba ic Electronic", "al o called a witching diode"). Today's extractor reads the file correctly, so these come from an older version of the code. | **Import again** (no code needed). |
| S6 | Normal | **A source stuck in PROCESSING blocks its course.** *Practical ways to do better market research* (From Basics) has been PROCESSING since the server restarted mid-import, so the import gate refuses regeneration of the whole course. | **Import again** or delete it. Long term: when the server restarts, mark sources whose import job is gone as FAILED with a clear message. |
| N1 | Normal | **OCR is English-only.** French slides and infographics come out garbled ("Limpulsion", "Contrdlé", "oe 1] ° fo ° °") and the noise pollutes ranking. | OCR `eng+fra` (configurable), and drop low-confidence words and symbol-only lines. |
| N2 | Normal | **Exact terms and acronyms rank weakly** (VWAP, RVOL, formula symbols): search is vector-only. | Hybrid search: PostgreSQL full-text plus vectors, merged by reciprocal-rank fusion. |
| N3 | Normal | Passages are embedded with `title: none`; EmbeddingGemma's recommended format includes the **document title**. | Embed with "title: \<source title — section/page\>", then re-embed (seconds). |
| N4 | Normal | **Cold start: 4.9 s.** Ollama unloads the embedding model after 5 idle minutes, so the first search after a pause waits for it to reload. | Send `keep_alive: "30m"` with embedding requests. |
| N5 | Normal (preventive) | With the index plus a per-course filter, pgvector's approximate search can return **fewer than k passages** once the database is large. Not reproducible at 127 passages. | Run searches with `hnsw.iterative_scan = relaxed_order` (pgvector 0.8.7 supports it). |
| L1 | Low | No overlap between passages: context at a boundary is split. | One-sentence overlap (needs re-indexing). |
| L2 | Low | The tutor's 8 passages can include near-duplicates; there is no diversity step. | Maximal-marginal-relevance (MMR) de-duplication. |
| L3 | Low | Exercise feedback searches with the exercise **title only**. | Search with the title, the prompt and the learner's answer. |
| L4 | Low | 768-d vectors are padded to 1536: half of each stored vector is zeros (storage only, not relevance). | `halfvec` or a 768-d column, later. |
| L5 | Low | The relevance floor of 0.30 sits inside a compressed score range (good hits score 0.33–0.44). | Re-calibrate after S1, N1 and N3, against an evaluation set. |

## Status (2026-10-16)

| # | Status |
|---|---|
| S1 | ✅ **Fixed.** The 4 placeholder sources were imported again with Whisper large-v3-turbo; 0 mock transcripts remain in your courses. Mock transcription is now refused outside tests unless `ALLOW_MOCK_PROVIDERS=true`, and a course that still holds a placeholder transcript can't generate until it is imported again. |
| S2 | ✅ **Fixed** (Database tab work). The HNSW index has been re-created, `npm run db:push` and `npm run db:setup` keep it, and `/admin → Database` can rebuild it. |
| S3 | ✅ **Fixed.** Guide, flashcards, quiz and exercises read the whole course when it fits `WHOLE_SET_TOKEN_BUDGET` (60k tokens for cloud models, 6k for local Gemma), and a spread sample beyond that. |
| S4 | ✅ **Fixed.** PDF pages without a text layer are rendered (`@napi-rs/canvas`) and read with OCR. The 3 slide PDFs went from 0 to 14, 15 and 14 passages. A file that yields no text now fails with a clear message instead of showing READY. |
| S5 | ✅ **Fixed** (data). *Electronics_Review.pdf* was imported again: 15 clean passages, the largest 400 tokens; none over 480 remain in your courses. |
| S6 | ✅ **Fixed** (data). *Practical ways to do better market research* was imported again (READY). The automatic restart handling is still open (§3, step 9). |
| N1–N5, L1–L5 | Open; see §3. |

**Passages per course after the fixes:**

| Course | Before | After |
|---|---|---|
| Trading – From Basics to advanced | 74 (51 of them placeholders) | **157** |
| Trading – Technical Analysis Guide | 30 | **59** |
| Schmémas électronique | 6 | **17** |

**Same searches, before → after:**

| Question | Kept, before → after | Top score, before → after | Top source after |
|---|---|---|---|
| Comment lire une bougie japonaise ? | 0/8 → **2/8** | 0.178 → **0.398** | The Only Day Trading Guide (now real transcript) |
| How does card counting in blackjack relate to quantitative trading? | 2/8 → **8/8** | 0.338 → **0.590** | Du_blackjack_au_trading_quantitatif.m4a |
| What is VWAP and how do day traders use it? | 6/8 → **8/8** | 0.440 → **0.571** | The Only Day Trading Guide |
| What is the relative volume (RVOL) filter? | 3/8 → **8/8** | 0.332 → **0.492** | The Only Day Trading Guide |
| What is a bullish engulfing pattern? | 8/8 → 8/8 | 0.436 → 0.443 | Price_Action_Playbook.pdf (now OCR'd) |
| Quelle est la stratégie du premier pullback ? | 8/8 → 8/8 | 0.437 → **0.508** | Tactical_Day_Trading_Blueprint.pdf (now OCR'd) |
| Explain photosynthesis in plants (off-topic) | 0/8 → 0/8 ✅ | 0.080 → 0.154 | (rejected) |
| How do I bake sourdough bread? (off-topic) | 0/8 → 0/8 ✅ | 0.097 → 0.113 | (rejected) |

<!-- GUIDES -->

## 1. What was measured

**Segmentation** (target 320 tokens, cap 480):

| Course | Source type | Passages | Avg / min / max tokens |
|---|---|---|---|
| Trading – Technical Analysis Guide | audio / note / image / video | 15 / 10 / 4 / 1 | 335 / 402 / 354 / 253, max ≤ 480 |
| Trading – From Basics to advanced | YouTube / PDF / audio / video / image | 37 / 21 / 11 / 3 / 2 | 336 / 318 / 320 / 341 / 308 |

No tiny passages (under 40 tokens). Every passage has an embedding (`ollama:embeddinggemma`), with no stale vectors from another model.

**Relevance**: top-8 searches, with how many cleared the 0.30 floor.

| Question | Course | Kept | Top score | Comment |
|---|---|---|---|---|
| What is a bullish engulfing pattern? | Technical Analysis | 8/8 | 0.436 | ✅ right material (French guide + infographic) |
| Quelle est la stratégie du premier pullback ? | Technical Analysis | 8/8 | 0.437 | ✅ cross-language works |
| How do I bake sourdough bread? | Technical Analysis | 0/8 | 0.097 | ✅ off-topic rejected |
| Explain photosynthesis in plants | From Basics | 0/8 | 0.080 | ✅ off-topic rejected, but the closest hits are **placeholder transcripts** (S1) |
| Comment lire une bougie japonaise ? | From Basics | **0/8** | 0.178 | ❌ the candlestick material is in the audio and YouTube sources, which are **placeholders** (S1); the top hit is OCR noise (N1) |
| How does card counting in blackjack relate to quantitative trading? | From Basics | 2/8 | 0.338 | ❌ the answer is in *Du_blackjack_au_trading_quantitatif.m4a*, a **placeholder** (S1) |
| What is VWAP and how do day traders use it? | From Basics | 6/8 | 0.440 | ⚠️ the only passage containing "VWAP" ranks in the top 8 but not the top 3 (N2) |
| What is the relative volume (RVOL) filter? | From Basics | 3/8 | 0.332 | ⚠️ both RVOL passages are found, with weak scores (N2) |

**Speed** (GTX 1080 Ti, warm): query embedding 42–84 ms, SQL 5–21 ms (sequential scan, no index). **First query after idle: 4,899 ms** (N4).

**Index with a per-course filter** (S2/N5): tested inside a rolled-back transaction. With a temporary HNSW index, every course still returned all its passages, because 127 rows is too small to show the effect. pgvector documents that filtered approximate search can under-fill results at scale; iterative scans are the fix.

## 2. Findings in detail

### S1 — Placeholder transcripts treated as real content
These sources were imported while `TRANSCRIPTION_PROVIDER="mock"` was active, before local Whisper was set up:

| Course | Source | Placeholder passages |
|---|---|---|
| Trading – From Basics to advanced | The Only Day Trading Guide… (YouTube) | 37 / 37 |
| Trading – From Basics to advanced | Du_blackjack_au_trading_quantitatif.m4a | 11 / 11 |
| Trading – From Basics to advanced | Stratégies_de_Trading.mp4 | 3 / 3 |
| Schmémas électronique | Decoding_the_Secret_Language_of_Circuit_Boards.mp4 | 1 / 1 |

Each placeholder reads like "[mock transcription 73] Lecture audio segment covering minute 14 of the recording…". The guide, flashcards and quiz of these courses were partly generated from that text, and the tutor can't answer questions about these recordings.

**Fix:**
1. Use **Import again** on the 4 sources: Whisper large-v3-turbo now transcribes them for real.
2. Regenerate the study material of both courses.
3. Prevent it happening again: refuse mock transcription unless `NODE_ENV=test` or an explicit `ALLOW_MOCK_PROVIDERS=true`. Mark any source whose transcript came from a mock provider with a warning badge, and make the import gate report it.

### S3 — Generation covers a fraction of each course
`retrieveForWholeSet` caps the material each generator sees:

| Generator | Passages it sees |
|---|---|
| Study guide outline | 24 |
| Flashcards | 20 |
| Exercises | 16 |

That is sampled evenly across sources, but for *From Basics* (74 passages, about 25k tokens) 68–78 % of the course is never shown to the model, and longer lectures make it worse. Today's cloud models take 128k (GLM) to 1M (Gemini) tokens.

**Fix:** choose passages by **token budget** instead of a fixed count: the whole course when it fits a per-model budget (for example 60k tokens for cloud models, 6k for local Gemma), stratified sampling beyond that. The guide's per-section retrieval stays as it is.

### N1 — OCR quality
`tesseract.js` runs with `createWorker("eng")` only. French images (*Piliers_du_trading_professionnel.png*, *Guide_d_analyse_technique_day_trading.png*) lose their accents and produce symbol noise, which then wins rankings it shouldn't.

**Fix:** `OCR_LANGS="eng+fra"` (the French model downloads once, like `eng.traineddata`); drop words below about 60 % confidence and lines that are mostly symbols.

### N2 — Hybrid search
Vector search is strong on meaning and weak on exact strings: acronyms (VWAP, RVOL), formula symbols, tickers and names.

**Fix:** add a PostgreSQL full-text column (the `simple` configuration, so it works in any language) with a GIN index. Run both searches and merge them by reciprocal-rank fusion in `searchChunks`. That is cheap (no extra AI calls) and keeps the citation flow unchanged.

### N3 — Document title in embeddings
EmbeddingGemma's document format is `title: {title} | text: {content}`; we always send `title: none`.

**Fix:** pass the source title plus the heading or page, then re-embed with `scripts/reembed.ts` (seconds at today's size).

### N4 — Cold start
Add `keep_alive: "30m"` to `/api/embed` requests. EmbeddingGemma is small (about 0.6 GB), so keeping it loaded costs little.

### N5 — Filtered approximate search at scale
In `searchChunks`, run the query in a short transaction with `SET LOCAL hnsw.iterative_scan = relaxed_order` and `SET LOCAL hnsw.ef_search = 100`. Results stay exact for small courses and fill up for large ones.

### S4 — Image-only PDFs produce nothing
`pdf.js` finds no text on any page of the three slide PDFs: 0 text characters and one picture per page. Images uploaded as PNG or JPG go through OCR, but PDFs don't, so these sources end up READY with no passages and nobody notices.

**Fix:**
- For each PDF page with (almost) no text layer, render the page and run OCR on it. Rendering in Node needs a canvas package such as `@napi-rs/canvas`; or extract the page's embedded picture directly, which suits slides exported as one image per page.
- Treat a source that ends with 0 passages as "no text found": a warning badge, plus a mention in the import gate and in the Database tab.

### S5 and S6 — Stale or stuck sources
These are data problems, not code problems:
- **Import again** *Electronics_Review.pdf* (S5) and *Practical ways to do better market research* (S6).
- The same applies to the 4 placeholder sources (S1) and, once S4 is fixed, to the 3 image-only PDFs.

## 3. Recommended order

1. **Data fixes** (no code): Import again the 4 placeholder sources (S1), *Electronics_Review.pdf* (S5) and the stuck YouTube source (S6), then regenerate both Trading courses and Schmémas électronique. Then the **mock guard** (about 1 h).
2. **S4** OCR fallback for image-only PDFs, plus the "no text found" warning (about 2–3 h; adds a canvas dependency). Then Import again the 3 slide PDFs.
3. **S3** coverage by token budget (about 2 h). This is the biggest quality gain for guides, flashcards, quizzes and exercises.
4. **N4 + N5** (about 30 min, low risk).
5. **N1** OCR languages and noise filter (about 1 h; re-import the image sources afterwards).
6. **N3** title-aware embeddings plus re-embed (about 1 h).
7. **N2** hybrid search (about half a day, including tests).
8. Build the **evaluation set** proposed in `docs/KAG-ASSESSMENT.md`: about 30 questions with expected passages, including unanswerable ones. Measure before and after steps 5–7, then re-calibrate the 0.30 floor (L5).
9. Low items (L1–L4) and the S6 restart handling when convenient.

_The Database tab (`/admin?tab=database`) revealed S4 and S5: its passage-size figures and per-course table show the 1,041-token passages and the sources with no passages._

_Evidence: code review of `src/lib/retrieval/*`, `src/lib/ai/embeddings.ts`, `src/lib/documents/parse.ts`, `src/lib/pipelines/{guide,flashcards,quiz,exercises,exercise-feedback,tutor}.ts`; read-only SQL statistics; live searches against your courses; a temporary HNSW index created and rolled back inside a transaction. No data was changed._
