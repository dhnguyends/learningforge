# PolyLingue — build plan

_Date: 2026-10-16 · Status: Phase 1 (MVP) built, with immersion from B2; Phase 2 complete (skills, adaptive difficulty within the chosen level, placement test, hints, lessons from your own material); Phase 3 built (reminders in the app and as browser notifications, installable app with offline lessons, badges and streak freezes, friends' leagues by invite code, weekly summary); Phase 4 built (Teacher role, classes joined with a code, assignments, class dashboard, common difficulties with suggested activities and CSV export, class leagues, privacy rules); Phase 5 planned_

## What we are building (my understanding)

**PolyLingue** is a language-learning space inside LearningForge, opened from a **PolyLingue** button on the Dashboard (`/polylingue`). A learner picks the language to learn and the language they already speak, then practises **10–15 minutes a day**. The design follows what worked for your students:

| Lever | Feature |
|---|---|
| Consistency | Daily goal, streak, reminders |
| Retention | Spaced repetition of words and structures, reviews |
| Confidence | Short lessons, instant correction with explanation, audio models, slow playback |
| Motivation | XP, streaks, achievements, leaderboards |
| Personalisation | Adaptive difficulty, teacher dashboard and assignments |
| Flexibility | Phone-friendly, installable (PWA) |

It complements teaching: the teacher dashboard turns practice data into class activities.

## What LearningForge already gives us

| Need | Reuse |
|---|---|
| Spaced repetition | FSRS scheduler (`src/lib/srs/fsrs.ts`), as used for flashcards |
| Translation, glosses | Translator selected at /admin (Azure: 138 languages; Gemma 4: 35) |
| Audio models, slow playback | Per-language voices (Kokoro, Piper, Azure, Gemini) and the audio cache |
| Speaking practice | Local Whisper (Speaches) speech-to-text |
| Lessons, explanations, writing correction | Generation model (GLM, Gemini or local Gemma) with JSON schemas |
| Fill-in-the-blank | Cloze helper (`src/lib/cloze.ts`) |
| Learning from your own material | Reading translations of sources (transcripts, documents) |
| Classification | Course tree: 7.4 Languages and Linguistics › 7.4.2 Language Learning |
| E-mail reminders | `SMTP_URL` (already used for password reset) |

To build: lesson content, exercise player, gamification, reminders (push), teacher role and classes.

## Phase 1 — MVP: "10 minutes a day" ✅ built

Goal: a learner can start a language, take short lessons with instant feedback and audio, review words with spaced repetition, and see XP, streak and progress.

1. **Entry point.** Add a **PolyLingue** button on the Dashboard, next to Explore. It opens `/polylingue` (protected like the other pages, with "Back to Dashboard").
2. **Data model.** Add these tables:
   - `LanguageCourse`: user, target language, base language, CEFR level, daily goal in minutes, XP, streak, last active day, time zone.
   - `LangUnit` and `LangLesson`: generated content as JSON, shared per target language, base language and level.
   - `LangExerciseAttempt`: answer, correct, time, skill.
   - `LangWord`: word or phrase, translation, example, audio key, part of speech.
   - `LangCard`: FSRS state per user and word.
   - `XpEvent` and `DailyActivity`: date, minutes, XP, lessons.
3. **Onboarding, level first.** The learner chooses:
   1. their **level**, A1, A2, B1, B2, C1 or C2, with a one-line description of what each level can do;
   2. the **language to learn** (Spanish, English, French, German, Italian or Portuguese);
   3. the **language for explanations** (English or French);
   4. a **daily goal** of 5, 10, 15 or 20 minutes.

   A learner can follow several languages, each at its own level, and change the level later.
4. **Curriculum generation, adapted per level.**
   - Each CEFR level has its own course. Its themes, vocabulary, grammar and exercises match what the level can do. For example, A1 covers greetings, numbers and the present tense with short sentences. B1 covers travel, work and past tenses with connected sentences. C1 covers argument, nuance and idioms with longer texts.
   - The level also sets the exercise mix (more recognition at A1, more production from B1), sentence length, and how much of the explanation language is used.
   - Each unit has 4–6 lessons, and each lesson 10–15 exercises.
   - The generation model writes them as schema-checked JSON.
   - Lessons are cached and shared, so the same language and level is generated only once.
   - Every target-language sentence gets an audio clip.
5. **Lesson player (5–10 minutes).** Six exercise types:
   - multiple choice;
   - type the translation;
   - listen and choose;
   - match pairs;
   - word order (tap the words into a sentence);
   - fill in the blank.

   Progress bar, keyboard and touch friendly.
6. **Instant feedback.**
   - **Checking:** each answer is checked immediately. Case and spacing are ignored, accents are tolerated, and a typo counts as "almost". Accepted alternatives come with the lesson.
   - **Correction:** a wrong answer shows the correct one and a one-line explanation.
   - **Retry:** a missed exercise comes back at the end of the lesson.
7. **Audio support.** Every target-language sentence has a play button and a **slow** button (0.75×), using the same voice choice as read-aloud.
8. **Vocabulary with spaced repetition.**
   - New words become FSRS cards.
   - The **Review** session mixes due words in both directions, with audio.
   - The home page shows "N words to review".
9. **Basic gamification.**
   - XP per correct answer and per finished lesson.
   - Daily goal ring.
   - Streak, counted in the learner's time zone.
   - "Lesson complete" screen.
10. **Progress page.** Lessons done, XP, an active-days calendar, words learned, and words to strengthen.
11. **Phone-first layout.** One column, large tap targets, works on a phone in portrait.
12. **Tests and docs.**
    - Answer checking (accents, typos, alternatives), XP and streak rules, scheduling, API access rules.
    - DEVELOPMENT.md, CHANGELOG.md.

## Phase 2 — All four skills, adaptive learning ✅ built

13. **Listening. ✅ built.** Dictation (listen and type), with slow replay.
14. **Speaking. ✅ built.**
    - The learner records a sentence with the microphone.
    - Local Whisper transcribes it, and the result is compared word by word.
    - Feedback highlights the missed words. Nothing is stored beyond the attempt.
15. **Reading. ✅ built.** Short texts at the learner's level, with comprehension questions. Tapping a word shows its translation, and it can be added to review.
16. **Writing. ✅ built.** A short prompt answered in a few sentences. The generation model corrects it with explanations (word order, agreement, accents).
17. **Adaptive difficulty. ✅ built.**
    - Track accuracy per skill and per word.
    - Adjust the mix: more exercises on weak skills, harder ones after streaks of success.
    - A **Practice weak words** session.
18. **Placement test. ✅ built.** 5 minutes, adaptive; it suggests the starting level.
19. **Grammar tips and hints. ✅ built.**
    - Short tips introduced in lessons.
    - A "hint" button on hard exercises.
    - Tapping a word shows its gloss and a grammar note.
20. **Learn from your own material. ✅ built.**
    - Turn a LearningForge source in the target language (a transcript or document, or its reading translation) into a lesson: key vocabulary and exercises.
    - Its words go into review.

## Phase 3 — Habit and motivation ✅ built

21. **Reminders. ✅ built (in the app and as browser notifications; e-mail not built).**
    - Browser notifications (Web Push with a service worker) at the time the learner chooses.
    - Optional daily e-mail through `SMTP_URL` (left for later: in-app and push were chosen).
    - "Your streak is at risk" in the evening.
22. **Installable app (PWA). ✅ built.** Manifest and icons, "Add to home screen", and the next lessons cached for offline practice.
23. **Achievements. ✅ built** (16 badges per language). Badges such as first lesson, 7-day streak, 100 words, perfect lesson; plus a streak freeze earned with XP.
24. **Leaderboards. ✅ built** as friends' leagues joined with an invite code and a nickname (class leagues come with Phase 4). Weekly XP leagues, opt-in, among friends or a class only. No public ranking by default.
25. **Weekly summary. ✅ built.** XP, time, words, and the skills to work on.

## Phase 4 — Teacher dashboard ("PolyLingue for Schools") ✅ built

26. **Teacher role. ✅ built.** A new TEACHER role (Human accounts only, like Admin), set by an admin.
27. **Classes. ✅ built.** A teacher creates a class with a target language and level. Students join with a code, and the teacher can remove students.
28. **Assignments. ✅ built.** Assign units or lessons with a due date. Students see them first on their PolyLingue home.
29. **Class dashboard. ✅ built.**
    - Activity per student: active days, minutes, streak, XP, assignments done.
    - Accuracy per skill.
    - **Students falling behind:** inactive for 3 or more days, or below the target.
30. **Common difficulties. ✅ built.** The words and grammar points the class misses most, with suggested in-class activities (role-play, speaking, grammar) generated from them. CSV export.
31. **Privacy rules. ✅ built** (class leagues are opt-in, with a nickname).
    - Teachers see only their classes.
    - Students see what is shared with the class.
    - Deleting an account removes its PolyLingue data.

## Phase 5 — Quality and scale

32. **Content review.** Admins can preview, edit, regenerate or retire generated lessons, and see error reports from learners ("report a problem").
33. **Better audio.** Pre-generate the audio of each lesson when it is created, and offer a voice choice per language.
34. **Analytics.** Retention (day 1, day 7, day 30), lesson completion, time per lesson, and the hardest exercises.
35. **Deployment.** Pod setup for the new services, a backup of PolyLingue data, and a load check.

## Decisions (answered 2026-10-16)

1. **Explanation language:** the learner picks English or French at onboarding. Explanations, hints and translations use it.
2. **Lessons:** generated by the selected AI model, checked against a schema, cached and shared per language and level. Admin review comes in Phase 5.
3. **MVP languages:** Spanish, English, French, German, Italian and Portuguese, which all have good local voices. More open later.
4. **Daily goal:** in minutes (5, 10, 15 or 20), with XP earned and shown.
5. **Users:** every account has PolyLingue.
6. **Leaderboards (Phase 3):** opt-in, among members of the same class only.
7. **Teachers (Phase 4):** a new TEACHER role, for Human accounts only, set by an admin. Teachers manage only their own classes.
