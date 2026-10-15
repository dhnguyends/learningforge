# Changelog

All notable changes to LearningForge.

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
- Run `npm run db:push`. It adds the `app_settings` table and the account `nature` and `lastActiveAt` columns. All existing accounts become **Bot**; mark people as **Human** in `/admin`. Only Human accounts keep admin rights.
- New optional `.env` settings are documented in `.env.example`:
  - Gemini: `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`;
  - GLM (Z.ai): `ZAI_API_KEY`, `GLM_AI_MODEL`, `ZAI_BASE_URL`;
  - local Whisper: `WHISPER_TIMEOUT_MS`.
- YouTube imports need a current yt-dlp: `python -m pip install -U "yt-dlp[default]"`.
