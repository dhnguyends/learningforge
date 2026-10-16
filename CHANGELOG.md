# Changelog

All notable changes to LearningForge.

## 2.1 — 2026-10-16

Courses are now organised in a four-level tree: Discipline › Subject › Course / Module › Topic.

### New features

**Course tree**
- **A shared catalogue of topics:** 9 disciplines, 34 subjects, 107 courses/modules and 460 topics, kept in `docs/COURSE-TAXONOMY.txt` and loaded with `npm run taxonomy:import` (safe to re-run; `npm run taxonomy:export` writes the tree back to the file).
- **Every name is unique in the whole tree.** Names that appeared twice were renamed (for example "Machine kinematics", "Image segmentation", "Financial derivatives"), and a duplicate is refused anywhere in the tree, ignoring case, accents and spaces.
- **Main topic of a course.** An administrator files each course under one topic; its Discipline, Subject and Course / Module follow automatically from the tree. The course page shows the path, read-only for its owner. The existing courses are filed, with a new **Technical analysis** topic under Finance › Investments.
- **Related ("connexe") topics.** A course can also link to up to 3 related topics, different from its main topic. The owner (or an administrator) adds or removes them from the Dashboard card's right-click menu, and the card shows "connexe : …" at the bottom.

**Explore**
- **Explore page** (top bar and Dashboard): browse the tree with the number of courses in each branch. Courses appear under their main topic and, marked "related", under their related topics. Users see their own courses; administrators can switch to all courses.
- **"Has courses"** hides every branch without a course (on by default, remembered per browser).
- **Search window** (arrow-in-a-circle button): type any part of a name to list every matching node, top to bottom, with its full path; choosing one opens its branch, scrolls to it and selects it.

**Administration**
- **Admin › Courses Tree** tab, between Courses and Database: the full tree with every course, to explore and maintain it.
  - **Insert child** adds a first child one level down; **Insert neighbour** adds the next node at the same level. Both are on the toolbar and in a right-click menu (Shift+F10 on the keyboard); Insert child is greyed out on topics, which have no children.
  - No parent can be created above an existing node, each node has one parent, and every change is audited. The tree can be downloaded as a `.txt` file.
- **Admin › Courses** shows each course's classification and lets administrators assign or change its topic.

**Navigation**
- **"Back to Dashboard"** button (graduation cap) in the top bar of every page except the Dashboard.

## 2.0 — 2026-10-16

LearningForge becomes bilingual: French courses can be read, searched and listened to in English. This release also adds a database monitoring tab, whole-course generation, and fixes for the source viewer and the semantic-search pipeline.

### New features

**Bilingual courses (French / English)**
- **Bilingual French / English sources.**
  - The language of each source is detected at import. French sources are translated to English: every passage gets an English twin with its own embedding (so English questions find French material), and every transcript segment gets its English text. Citations always point at the original.
  - The translation runs after the source is ready, so it never delays generation. Sources imported earlier can be translated from their page with **Translate to English**.
  - Search folds translations back into their originals (each passage counts once); whole-course generation ignores them.
- **Read and listen in either language.** The source page (transcript or document text) and the Transcript page have an **FR / EN** switch and **Read aloud**: segment after segment, highlighted, click a timestamp or page to read from there. Clips are generated on first play and kept with the source.
- **Translator and text-to-speech selectors in `/admin` → AI model.**
  - Translator: Gemma 4 (local, Ollama) or Azure AI Translator, with a test translation.
  - Read-aloud: Kokoro-82M or Piper (local, Speaches server), Azure Neural TTS or Gemini 3.8 Flash-Lite TTS, with a voice per language and a sample to listen to.
  - Cloud options show a privacy warning and stay disabled until their key is in the server `.env` (`AZURE_*`, or the Azure portal names `AZ_API_KEY1`, `AZ_VOICE_SYNTHESIS`, `AZ_API_TRANSLATE`).

**Study material**
- **Whole-course generation:** study guide, flashcards, quiz and exercises now read the **whole course** when it fits the model's budget (`WHOLE_SET_TOKEN_BUDGET`, 60k tokens for cloud models; `WHOLE_SET_TOKEN_BUDGET_LOCAL`, 6k for local Gemma). Before, they read 16–24 sampled passages.

**Administration and operations**
- **Database tab in `/admin`** for monitoring the vector database. It shows:
  - database and uploaded-file sizes;
  - courses, sources and passages, and the share of passages with a vector;
  - segmentation (smallest, average, 95th-percentile and largest passage against the 320/480-token target), by source type and in a sortable per-course table;
  - embedding features: provider, model, model vs stored dimensions, bytes per vector, total vector storage, similarity metric and relevance floor, passages per embeddings model;
  - the largest tables (data, indexes, overflow);
  - health of the semantic-search (HNSW) index, with a **Create / Rebuild index** button. It builds concurrently, so searches and imports keep running.
- **GPU in the top bar.** The GPU used for local processing (transcription, embeddings, local models) is shown next to the AI model, for example "GTX 1080 Ti", or **No GPU**. It is detected with `nvidia-smi`. Without a GPU, processing runs on the CPU and its timeouts are multiplied by `CPU_TIMEOUT_FACTOR` (default 4).
- **Cloud keys on the GPU pod** live in `~/lectureforge-data/extra.env`, which `deploy/packet/setup.sh` appends on every deploy. The keys never travel through git.

### Fixes

**Source viewer**
- **PDF sources were blank** on the source page: the app sent `X-Frame-Options: DENY` everywhere, so the browser refused to show the PDF in the page's own frame. `/api/files` now allows same-origin framing only (it serves an allow-list of types, never HTML or SVG); every other page still refuses framing.
- **Image sources** had no preview. They now display inline, and a click opens them full size.
- **Word (.docx) sources** could not be displayed, since browsers cannot render Word files. They are now converted to formatted text on the server (headings, lists, tables, links, embedded pictures), sanitized with a strict allow-list, with a link to download the original.

**Search and generation (RAG audit, see `docs/RAG-AUDIT.md`)**
- **Image-only PDFs** (scans, slides exported as pictures) were imported with no text and still showed READY. Pages without a text layer are now rendered and read with OCR, and a file that yields no text fails with a clear message instead.
- **Placeholder transcripts:** mock transcription is refused outside tests unless `ALLOW_MOCK_PROVIDERS=true`, and a course whose sources still hold placeholder transcripts can't generate until they are imported again.
- **Vector index lost on schema updates.** `prisma db push` silently dropped the HNSW vector index, so semantic search scanned every passage. `npm run db:push` and `npm run db:setup` now re-create it, and the server warns at startup when it is missing.
- **Stuck and damaged imports** found by the audit (placeholder transcripts, a stuck YouTube import, a PDF with missing letters, image-only PDFs) were imported again, and the three study guides were regenerated from the whole course.

## 1.2 — 2026-10-16

### New features

**AI models**
- **Choose the generation model at `/admin`.** Options are local Gemma 4 (Ollama), Google Gemini (`gemini-3.8-flash`, `gemini-3.5-flash-lite`) or GLM served by Z.ai (`glm-5.3-flash`).
  - The choice applies to study guides, flashcards, quizzes, exercises, feedback, audio recaps and the tutor.
  - It takes effect without a restart, and every change is audited.
  - API keys stay in the server `.env`.
- **Active model in the top bar.** The centre of the top bar shows the model in use; admins can click it to change it.
- **Gemini by default.** Gemini is the default (`AI_PROVIDER="gemini"`, `GEMINI_MODEL`). Without a key, the app falls back to the local model.
- **Resilient cloud calls.**
  - Each Gemini or GLM attempt has its own timeout, and rate-limit or overload answers are retried.
  - If Gemini stays unavailable or over quota, the call fails over to `GEMINI_FALLBACK_MODEL` (default `gemini-3.5-flash-lite`).
  - GLM gets the schema's size limits stated in the prompt, and its output is trimmed to them, since Z.ai has no schema-constrained output.
- **Local speech-to-text.** Whisper `large-v3-turbo` runs on a local Speaches (faster-whisper) server on the GPU, with segment timestamps for citations. Setup is in `DEVELOPMENT.md`.

**Study sets and sources**
- **Generation waits for complete imports.** Study guide, flashcards, quiz and exercises are generated only once every source is imported (vectorized and indexed).
  - The buttons are disabled meanwhile, with the reason shown.
  - Automatic generation runs once, when the last source finishes.
- **Per-source "Import again" and "Delete".** Both are on the Sources page. Import again re-transcribes or re-parses a source and re-indexes it, for example after a failed import.

**Administration** (`/admin`, now in tabs: Users · AI model · Courses)
- **Users**
  - New **Nature** column (Human or Bot) and **Last used** column.
  - One-click **Promote to Admin**, and a visible **Delete** button.
  - Accounts created by code (tests, scripts, AI agents) are Bots by default.
- **Only Human accounts can be Admin.** A Bot must be made Human before promotion. This is enforced by the API and by the session, not only by the form.
- **Promotions and demotions apply immediately,** without signing out.
- **`/admin` is closed to standard accounts.** It is checked by the middleware and by a server-side check against the database. Standard accounts see an **"Access denied"** pop-up.
- **Courses**
  - Lists every study set with its owner: Human accounts first, then Bot accounts. The list is searchable.
  - **Change owner** gives a course to another account, with its files and learning history.
  - **Delete course**, plus a prompt to delete **empty courses** (no sources).
- **Deleting an account removes everything it owns:** all its study sets, sources and stored files.

**Development**
- Optional local HTTPS dev server (`npm run dev:https`, using mkcert).

### Fixes
- **YouTube imports** failed with "HTTP 403 / SABR streaming". yt-dlp now uses Node.js as its JavaScript runtime and the bundled ffmpeg, and the error says to update yt-dlp.
- **Delete buttons did nothing** in embedded browsers and with popup blockers: they relied on the browser's native confirm, which those block. They now use an in-app confirmation dialog.
- **Audio sources showed a 0 s duration.** They now use the duration the transcriber measured.
- **Re-importing a video or YouTube source** no longer adds a duplicate audio record.
- **Long transcriptions** no longer time out after 10 minutes and re-upload. `WHISPER_TIMEOUT_MS` defaults to 1 h.
- **Clear errors** when Ollama (embeddings) isn't running and when a Z.ai account has no balance.
- **Deleting an account or study set** removes the database rows before the stored files, so a failure can no longer leave courses pointing at missing files.
- **API tests** no longer interfere with each other or temporarily demote the database's real administrators.

### Upgrade notes
- Run `npm run db:push`. It adds the `app_settings` table and the account `nature` and `lastActiveAt` columns. **Correction:** in 1.2 this command also dropped the semantic-search (HNSW) vector index. Afterwards, run `node scripts/ensure-vector-index.mjs` (or `npm run db:push` again after updating to the next version), or use **Create index** under `/admin` → Database. All existing accounts become **Bot**; mark people as **Human** in `/admin`. Only Human accounts keep admin rights.
- New optional `.env` settings are documented in `.env.example`:
  - Gemini: `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`;
  - GLM (Z.ai): `ZAI_API_KEY`, `GLM_AI_MODEL`, `ZAI_BASE_URL`;
  - local Whisper: `WHISPER_TIMEOUT_MS`.
- YouTube imports need a current yt-dlp: `python -m pip install -U "yt-dlp[default]"`.
