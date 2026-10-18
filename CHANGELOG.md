# Changelog

All notable changes to LearningForge.

## Unreleased

### New features
- **Tutor: "Search my sources" switch** (above the tutor's modes, on by default, remembered per study set in the browser). Off, a question is sent **without semantic search**: no passages are retrieved or added to the prompt, the tutor answers from general knowledge with its usual teaching rules (hints first, solutions on request, academic integrity), and the answer is labelled *General knowledge · sources not searched*, without citations. *Show source* needs the search and is unavailable while it is off. API: `POST /api/tutor/<conversation>/messages` takes `sourceSearch` (default `true`); the choice is recorded on both messages.

- **Local translator models** (Admin › AI model › Translator): every chat model installed in Ollama can translate (Gemma 4, DeepSeek-R1…), besides Azure AI Translator. **One model on the GPU**: while the AI model is local, a local translator must use that same model (other local models are greyed out with the reason; the server refuses them too), and switching the AI model to another local model moves a local translator with it, which the AI card reports. With a cloud AI model, any local model may translate. DeepSeek-R1 translates with its reasoning kept out of the result.

- **Tutor: answer timer.** While the tutor answers, a timer counts from sending the question (⏱ HH:MM:SS); each answer then shows its time to answer, measured until it is on screen. **Hovering the timer shows the AI model** that answered (or is answering). Both are saved with the answer (message metadata: `model`, `modelLabel`, and `displayedMs` sent by the browser through `PATCH /api/tutor/<conversation>/messages/<message>`, first value kept), so the learner finds the same timer and tooltip in a later session; older answers show the time recorded by the server.
- **Tutor: rename and delete conversations** from the conversation list's right-click menu (also Shift+F10, or the ⋯ button): **Rename…** changes the title (“New conversation” by default), **Delete…** removes the conversation and its messages after a confirmation (audited). API: `PATCH` / `DELETE /api/tutor/<conversation>`, the learner's own conversations only.

- **GPU memory released with cloud models.** Choosing cloud models for both the AI model and the translator now unloads the local language models at once (they used to stay up to 5 minutes, Ollama's keep-alive); a local translator keeps its model, and the embeddings model stays for search. The AI model and Translator cards report what was unloaded and the GPU memory before and after (measured with nvidia-smi: Ollama misreports some models' sizes, so per-model sizes are no longer shown).

- **"Runs on" column** in every admin model list (AI model, Translator, Text to speech, PolyLingue voices): *Local · Ollama*, *Local · Speaches* or *Cloud · Google / Z.ai / Microsoft Azure*, with an icon; the PolyLingue voices show where the voice in use runs.

### Documentation
- **User Guide** (`docs/USER-GUIDE.md`) and **Administrator and Teacher Guide** (`docs/ADMIN-GUIDE.md`), with screenshots of every page. `npm run guides:screenshots` takes them again from the running server (`scripts/guides/`), with temporary accounts that are deleted afterwards and other people's names replaced.

### Fixes
- **Study set Analytics** stayed on its loading placeholder for any learner with quiz results: the server computed the topic trends before reading the quiz history (an error since the first version).

## 3.0 — 2026-10-17

PolyLingue quality and scale (Phase 5): administrators review the AI-written lessons, learners report problems, analytics, and lesson audio ready ahead of time. Learners can change level, and speaking practice keeps their recorded answers. DeepSeek-R1 joins the local AI models, one model at a time on the GPU. A developer guide and an optional PyTorch container for GPU notebooks.

### New features

**Local AI models (Admin › AI model)**
- **DeepSeek-R1 8B** can be chosen as the generation model, next to Gemma 4: every chat model installed in Ollama is listed (embeddings-only models are not). DeepSeek-R1 always reasons before answering; the app keeps the reasoning out of the answer and gives it its own token budget.
- **One model at a time on the GPU:** choosing a local model unloads every other Ollama model first (Gemma 4, the embeddings model…), checks that they are gone, then loads the chosen one; the card reports what was unloaded and the GPU memory before and after. Jobs and local translation do the same when their model is not loaded yet (the small embeddings model stays).
- **GPU memory panel:** the card shows the GPU memory in use and the models Ollama holds, refreshed every 10 seconds, with a **Free GPU memory** button.

**Development**
- **Software developer guide** (`docs/SOFTWARE-DEV-GUIDE.md`): the libraries and versions in use, system packages and services, the AI models available for each feature (generation, tutor, translation, speech-to-text, text-to-speech, embeddings, OCR), the architecture, and recipes for common changes.
- **Optional PyTorch container** for notebooks and experiments on the GPU: PyTorch 2.14.1 with CUDA 12.6 (still supported on the GTX 1080 Ti) and JupyterLab, started with `docker compose --profile pytorch up -d pytorch`; `deploy/pytorch/gpu-check.py` checks that it really runs on the GPU. The app itself does not use PyTorch.

**Change level**
- **Right-click a language** in PolyLingue's left panel (or Shift+F10 on it) for **Change level…**: choose another level of the same language. Each level shows whether its shared course is ready, being written, or will be written; switching to a level nobody started has the AI model write that course first. XP, words, streak and badges are kept; below B2 the explanation language can be chosen, and a learner in a class is told the class stays on its own level.

**Speaking practice**
- **Your spoken answers are kept:** for each sentence and question, the **latest** recording and the **best** one (highest score) are saved as WAV on the server (`lang_recordings` table, files under `polylingue/recordings/<user>/<course>/`). Play them back under the item ("My latest", "My best", or "My best = latest"), or save them as `.wav`. Only the learner can hear them. The bin icon next to a recording deletes it (database row and `.wav` file, after a confirmation; a take kept as both latest and best is deleted as one), "Delete them" removes all of a practice's recordings, and they are deleted with the course or the account.
- **Micro settings** (top right of the speaking card): choose the microphone, turn noise suppression, echo cancellation and automatic volume on or off, watch the input level, and record a 3-second test to play back. Saved in this browser and used by every Record button.

**Content review (Admin › PolyLingue)**
- **Content:** every shared course (language, level, explanation language) with its learners and classes, lessons ready or retired, lessons with audio, open reports and hidden exercises; open a course to see its lessons unit by unit, marked edited, retired, reported, hidden or with audio ready.
- **Lesson review** (`/admin/polylingue/<lesson>`): correct the title, introduction, words and each exercise in place (prompt, text, answer, options, other correct answers, pairs, explanation, audio). Exercises keep their number and type, and each correction is checked (the answer must be one of the options, a fill-in sentence needs its blank…). **Regenerate** has the AI model write the lesson again; **Retire** stops offering it (progress on it stays) and **Bring back** undoes it. Every change keeps the version before, and **Restore** brings back any earlier version.
- **Reports:** the open reports, grouped by exercise, with their reasons and comments; **Review** opens the exercise, **Dismiss** closes its reports without changing it. Correcting an exercise closes its reports and shows it again.
- **Report a problem** (learners): after each answer, report a wrong answer, an unclear question, a mistake, wrong audio or something else, with an optional comment. An exercise reported by **3 different learners** is skipped until an administrator reviews it.

**Analytics (Admin › PolyLingue)**
- Learners (people and test accounts), active in the last 7 and 30 days, **retention** (came back on day 1, 7 and 30 after starting), lessons completed and the completion rate, average score, **time per lesson**, learners active per day over 30 days, the **hardest exercises** (5 answers or more, with a link to review them), and each shared course's learners, lessons completed and average score.

**Voices and audio ahead of time**
- **A voice per language** (Admin › PolyLingue › Voices & audio): a local Kokoro or Piper voice for Spanish, English, French, German, Italian and Portuguese, with a sample to listen to; without a choice, the read-aloud model of Admin › AI model is used as before.
- **Lesson audio ready before learners need it:** with a local voice, a lesson's audio (words, sentences, words to match) is generated as soon as the lesson is written, one lesson at a time; the audio button of a course generates it for lessons that already exist. Paid cloud voices are never used ahead of time.

**Deployment (prepared; the pod was not started)**
- `npm run polylingue:backup` / `npm run polylingue:restore -- <file>`: PolyLingue data only, restored without overwriting (rows whose account, course or lesson is missing are skipped and counted).
- `npm run load:check`: read-only load test with many virtual learners, with p50 / p95 / p99 per endpoint.
- The pod's `setup.sh` generates the browser-notification keys once; `DEPLOYMENT.md` has a PolyLingue section.

### Fixes
- **PolyLingue lesson page** no longer renders its offline placeholder on the server (Node 21+ has a `navigator` without `onLine`), which caused a hydration error and a moment of blank page.
- **Microphone in speaking practice:** it was blocked when PolyLingue was opened from another page of the app (the Dashboard's policy, which refused the microphone, stayed in force without a full reload). The microphone is now allowed for this site on every page (`microphone=(self)`); only speaking practice uses it.
- **Clearer microphone messages:** when the window itself forbids the microphone (for example the browser panel inside the Claude app), the learner is told to open LearningForge in Chrome, Edge or Firefox, instead of being sent to the site settings; a refused permission, a missing microphone and a microphone used by another app each get their own advice.

### Upgrade notes
- Run `npm run db:push`: adds learner reports, retired / hidden-exercise / audio / edited fields on lessons, time spent per lesson, and the `lang_recordings` table for kept spoken answers.
- Local AI: models are listed from Ollama, so `ollama pull deepseek-r1:8b` (or any chat model) makes it selectable in Admin › AI model; `LOCAL_AI_MODEL` stays the default.
- New npm scripts: `polylingue:backup`, `polylingue:restore`, `load:check`.

## 2.6 — 2026-10-17

PolyLingue for Schools: teachers run classes, give assignments and follow each student, with the class's common difficulties and suggested activities.

### New features

**PolyLingue for Schools (Phase 4)**
- **Teacher role:** administrators can make a Human account a **Teacher** (Admin › Users); like Admin, it is never effective on a Bot account. Teachers and administrators get a **Teaching** page in PolyLingue's left panel.
- **Classes:** a teacher creates a class for a language, a level and an explanation language, with a weekly target in minutes, and shares its code (like K7Q-2MX; a new code can be made at any time). The class follows the shared course for that level.
- **Joining:** students use **My classes › Join a class**. Before confirming they see the class, its teacher and what changes: their course in that language moves to the class level and explanation language, keeping XP, words and streak, and their teacher will see their activity in that language. Students can leave at any time; teachers can remove a student. Neither deletes the student's course or progress.
- **Assignments:** a whole unit or one lesson of the class course, with a due date and a note. Students see open assignments **first on their PolyLingue home** and on the course page, with a Start button on the next lesson to do; each one shows To do, Overdue, Done or Done late.
- **Class dashboard:** per student, active days (7 and 28 days), minutes and XP this week, streak, assignments done and overdue, and accuracy per skill. **Falling behind** is flagged with the reason: no practice for 3 days or more, below the weekly target, or overdue work. Each assignment shows how many students finished it.
- **Common difficulties:** the words the class forgets most, the exercises it misses most and the grammar points (units) with the lowest accuracy. **Suggest activities** has the AI model write 3 to 5 in-class activities (role-play, speaking, grammar, vocabulary, games…) from them; they are kept on the class.
- **CSV export** of the dashboard (opens in Excel or LibreOffice with accents intact; cells that would run as spreadsheet formulas are neutralised).
- **Class league:** opt-in per student, under a nickname; classmates who joined see this week's XP ranking in the class language, and nothing else about each other.
- **Privacy:** teachers see only their own classes. Deleting an account removes all its PolyLingue data (courses, words, answers, classes taught, memberships, leagues, reminders, browser subscriptions, offline results).

### Fixes
- **Offline lesson results** of a deleted course or account are now deleted with it (they used to remain).
- **Common difficulties** list tied exercises in a fixed order (by lesson, then exercise).

### Upgrade notes
- Run `npx prisma db push && node scripts/ensure-vector-index.mjs`: adds the `TEACHER` role and the class tables (classes, members, assignments), and links offline results to their course.
- No new settings or keys. Make teachers in Admin › Users (Human accounts only); administrators can teach as well.

## 2.2 — 2026-10-16

PolyLingue, a language-learning app inside LearningForge (phases 1 to 3), and sources you can translate into any language, correct by hand and scan with OCR.

### New features

**PolyLingue**
- **PolyLingue, learn a foreign language (Phases 1 and 2)**: a **PolyLingue** button on the Dashboard and in the Admin header opens `/polylingue`.
  - **Onboarding, level first:** choose your CEFR level (A1 to C2, each described), then the language to learn (Spanish, English, French, German, Italian, Portuguese), the language for explanations (English or French) and a daily goal (5, 10, 15 or 20 minutes). Several languages can be followed, each at its own level; the level can be changed later.
  - **A course per level:** the selected AI model writes the course for each language and level once (6 units of themed lessons with that level's vocabulary, grammar, sentence length and exercise mix), shared by every learner; each lesson is written the first time it is opened, and the next one ahead of time.
  - **Short lessons with instant correction:** 10–12 exercises of six types (multiple choice, listen and choose, match pairs, word order, fill in the blank, translate). Each answer is checked at once, forgiving case and punctuation; a missing accent or small typo counts as "almost". The correct answer and a one-line explanation follow, and missed exercises come back at the end.
  - **Audio and slow playback** on every word and sentence, with the per-language voices.
  - **Spaced review** of the lesson's words (FSRS), with audio and examples.
  - **XP, daily goal ring, streak** (in your time zone), lesson score, and a **progress page**: XP, best streak, lessons, words learned and mastered, accuracy, a 5-week calendar, and words to strengthen.
  - **Immersion from B2:** B2, C1 and C2 courses are written entirely in the language learned (titles, instructions, explanations, word definitions); rewriting exercises replace translation, and an answer that is not in the expected list is judged by the AI model. Immersion courses are shared by every learner of the language and level.
  - **Restart a lesson** from the start (while playing, or "Do it again" at the end).
  - **Multi-skill practice**, from a panel on the left (Lessons, Reading, Listening, Writing, Speaking, Review, Progress); one practice per skill and unit, on the unit's theme and level:
    - **Reading:** a text with underlined words (tap for the meaning, add to review), listen to the text, comprehension questions.
    - **Generate a reading:** choose a source (newspaper, magazine, novel, textbook, research thesis) and a subject (history, news, literature, science fiction, or your own topic); the AI model writes a text in that style at your level, with a glossary and questions. Personal readings are listed under "Your readings" and visible only to you.
    - **Listening:** dictation (listen, normal or slow, and type), then a dialogue or monologue played sentence by sentence with questions; the transcript appears at the end.
    - **Writing:** tasks with useful words and a word counter; the AI teacher scores the text, corrects each mistake with an explanation, gives feedback and a model answer.
    - **Speaking:** repeat sentences after the model (your recording is transcribed by local Whisper and compared word by word, missed words shown), and answer questions aloud (transcribed, then corrected like writing). Recordings are not stored; the microphone is allowed on PolyLingue pages only.
  - **Adaptive difficulty, always within the level you chose** (the level never changes by itself):
    - **Support / Standard / Challenge modes** from your last 40 lesson answers: under 60 % right, typed answers get a word bank and listening plays slowly first; 90 % or more, multiple-choice and fill-in answers must be typed. The lesson content stays the same.
    - **Weak words:** a session on the words you forget or miss most (recognise, hear, write), built from your own words; each answer reschedules the word's review.
    - **Recommendations** on the course page: redo a lesson scored under 60 %, practise weak words, or review.
    - **Accuracy by skill** (lessons, reading, listening, writing, speaking, weak words) and the current mode on the progress page.
  - **Grammar tips and hints:** each lesson starts with its unit's grammar focus; a **Hint** button gives a clue without the answer (written once by the AI model and kept for every learner; a hint halves that exercise's XP); lesson words are underlined in exercises — tap for the meaning — except words that would give the answer away.
  - **Learn from your own material:** "Make a lesson" turns one of your LearningForge sources (lecture, document, video) available in the language you learn — originally or through its translation — into a personal lesson at your level, part by part; its words go into review when you finish it.
  - **Placement test** (about 5 minutes, at most 12 questions): adaptive from A2 up and down, mixing grammar, vocabulary, reading and listening; questions written once per language by the AI model and checked by a second review pass. It suggests a level that you confirm, from onboarding ("Not sure? Take the placement test") or from course settings.
  - **Left panel** on every PolyLingue page: your languages, then Lessons, Reading, Listening, Writing, Speaking, Weak words, Review and Progress of the open language (or of your most recent one on the PolyLingue home). Language badges replace flag emojis, which Windows does not draw.
- **PolyLingue Phase 3, habit and motivation.** A "Keep going" section in the left panel: Badges, Leagues, Weekly summary and Reminders. Streak freezes are also shown on the course page and progress calendar.
  - **Badges:** 16 per language (first lesson, flawless lesson, 10 and 50 lessons, 3-, 7- and 30-day streaks, 100 and 500 words, 1,000 and 5,000 XP, 100 reviews, all four skills, a lesson from your own material, daily goal 7 days in a row, saved by a streak freeze). A dialog announces each new badge once.
  - **Streak freezes:** one earned every 300 XP, two held at most. A missed day is covered by itself and shown in blue on the calendar; the course page shows how many you hold.
  - **Reminders:** a daily reminder at the time you choose when the goal is not met, "your streak is at risk" in the evening, and the weekly summary on Mondays. They show at the top of PolyLingue (dismissible for the day), and as **browser notifications** once turned on (Web Push, with a test button). The server sends each reminder once a day; expired browser subscriptions are removed.
  - **Friends' leagues:** create a league and share its invite code (like K7Q-2MX), or join one; weekly XP across all your languages, ranked from Monday, with a nickname instead of your name. Last week's podium is shown. Opt-in, up to 5 leagues of 50 members; leaving as the last member deletes the league.
  - **Weekly summary:** per language, XP and minutes (compared with the week before), active days, goal days, lessons, reviews, new words, accuracy per skill and what to work on; browse week by week.
  - **Installable app with offline lessons:** PolyLingue can be installed (manifest, icons, "Install the app" in the left panel). "Available offline" on a course page saves the next 3 lessons and their audio on the device (optionally kept up to date); without a connection they open and are corrected in the browser, and the results are added to your progress once you are back online (each run once).

**Sources: translations, editing and OCR**
- **Translate any source to read and listen to it.** The source page and the Transcript page have a **Translate…** button that lists every language the active translator offers (about 140 with Azure AI Translator, 35 with local Gemma 4). The chosen language appears as a new language pill next to the original.
  - These reading translations are **not vectorized**: search, citations and generated material are unchanged. (French sources still get their searchable English translation as before.)
  - **Read aloud** works in every language it can find a voice for: the selected model when it speaks the language, otherwise a local Kokoro (8 languages) or Piper (about 40 languages) voice, otherwise Azure Neural TTS or Gemini TTS when their key is set. The button shows the voice it uses, and is greyed out with an explanation when no voice speaks the language.
  - **Progress bar** while a translation runs: percentage, items done out of the total, and the estimated time left (from the speed so far, counting down every second). It also shows for the French → English translation.
- **Edit any transcript or text, original or translation.** An **Edit** button next to the language pills (source page and Transcript page) opens the shown language in an editor, passage by passage, to correct OCR text, a transcription or a machine translation:
  - **Undo / Redo** (Ctrl+Z, Ctrl+Y), **Find and replace** (Ctrl+F: match case, whole word, next / previous, replace, replace all, only passages with a match).
  - **Case:** UPPERCASE, lowercase, Sentence case, Title Case, on the selection or the passage.
  - **Clean up** OCR and transcription artefacts, in a passage or the whole text: join broken words ("remov- ing" → "removing"), join lines broken mid-sentence, remove extra spaces (keeping French spacing before ; : ! ?).
  - **Special characters** (quotes, dashes, accents, symbols), **spell check** in the text's language (right-click for suggestions), word count, restore a passage, a warning before leaving with unsaved changes. Ctrl+S saves.
  - Plain text only (no bold or italics), because the text is searched, cited and read aloud.
  - Saving re-indexes what search uses: a corrected original passage, or the English search translation of a French source, gets a new embedding; a corrected transcript rebuilds the passages covering the changed segments. Reading translations are saved without being vectorized. The text before each correction is kept, and corrected passages are marked "edited". Reprocessing the source (or translating again into that language) replaces the corrections.
- **Right-click menu on a translation** (its language pill, or the translated transcript or text; Shift+F10 from the keyboard): **Edit** it, **Translate again** into the same language, or **Delete** it. After a deletion the page offers to translate into that language again ("Translate again" / "Not now"). The original is never deleted; the confirmation says when hand corrections would be lost, or when the deleted translation is the English one search uses.
- **Scan with OCR** on PDF and image sources: re-reads every page as an image, in the source's language (English, French, Spanish, German, Italian, Portuguese), for scans whose text is missing or garbled. A page keeps its text layer when OCR reads it less well (fewer real words, low confidence), so a good layer is never degraded. The source page says how its text was obtained: text layer, OCR on some or all pages, or text layer kept after a scan.

### Fixes
- **AI model choice kept:** the admin settings tests no longer overwrite the live AI model and speech settings (a model chosen at Admin › AI model could seem not to take effect after a test run).
- **No "[Source 1]" markers** in texts generated for study (PolyLingue readings and lessons made from your sources).
- **Azure read-aloud** picks a language's plain Neural voice before the HD / Dragon voices, which cost more.

### Upgrade notes
- Run `npm install` (adds `web-push`), then `npx prisma db push && node scripts/ensure-vector-index.mjs` for the new PolyLingue tables (badges, leagues, reminders, push subscriptions, offline syncs) and columns (streak freezes, frozen days).
- **Browser notifications (optional):** add `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` to `.env` (`npx web-push generate-vapid-keys`) and restart the server. Without them, reminders show in the app only.
- The server now uses Next.js instrumentation (`src/instrumentation.ts`) to start the reminder pass, and serves `/sw.js`, `/polylingue.webmanifest` and `/icons/` without the access key (browsers fetch the manifest without cookies).

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
