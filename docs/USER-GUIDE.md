# LearningForge — User Guide

LearningForge turns your course material (lecture videos, slides, PDFs, notes) into study material you can trust: a study guide, flashcards, quizzes, exercises and a tutor, each linked to the exact passage of your sources it comes from. It also includes **PolyLingue**, for learning a foreign language ten minutes a day.

This guide is for learners. Administrators and teachers have their own guide: [ADMIN-GUIDE.md](ADMIN-GUIDE.md).

**Contents**

1. [Signing in](#1-signing-in)
2. [The Dashboard](#2-the-dashboard)
3. [Creating a study set](#3-creating-a-study-set)
4. [Inside a study set](#4-inside-a-study-set)
5. [Sources, transcripts and translations](#5-sources-transcripts-and-translations)
6. [Study guide](#6-study-guide)
7. [Flashcards](#7-flashcards)
8. [Quizzes](#8-quizzes)
9. [Exercises](#9-exercises)
10. [The tutor](#10-the-tutor)
11. [Analytics](#11-analytics)
12. [Explore](#12-explore)
13. [Settings and your data](#13-settings-and-your-data)
14. [PolyLingue: learning a language](#14-polylingue-learning-a-language)
15. [Tips and questions](#15-tips-and-questions)

---

## 1. Signing in

LearningForge is invite-only: an administrator creates your account and gives you your email and password. If the site asks for an **access key** first, your administrator gives you that too.

![Sign-in page](images/user/02-sign-in.png)

- **Forgot password?** sends a reset link to your email.
- The sun / moon button switches between light and dark themes.

**The top bar** is the same on every page:

| Element | What it does |
|---|---|
| **AI model** · **GPU** (centre) | The AI model that writes your study material (for example *Gemma 4 · local*), and the graphics card used for local processing. |
| **Back to Dashboard** | Returns to your Dashboard from any page. |
| **Explore** | Your courses organised by discipline and topic ([section 12](#12-explore)). |
| **New study set** | Starts a new study set ([section 3](#3-creating-a-study-set)). |
| Your initial (right) | Settings and sign out. |

---

## 2. The Dashboard

![Dashboard](images/user/03-dashboard.png)

- **The four counters**: your study sets, the sources still being processed, the flashcards due today, and the study sets ready to study.
- **Study sets**: one card per course. A card shows its classification (for example *Deep Learning › Backpropagation*), what has been generated (sources, decks, quizzes, exercise sets) and the cards due. A running import shows a progress bar.
- **Processing** (right): imports and generations in progress.
- **Review queue**: the cards due across all your study sets; click a set to review them.
- **Progress**: how far each set is indexed.
- **PolyLingue** opens the language app ([section 14](#14-polylingue-learning-a-language)).

Right-click a study set card for more actions, such as linking **related topics** (up to three, shown on the card).

---

## 3. Creating a study set

Click **New study set**. Creating one takes three steps: **Details**, **Sources**, **Processing**.

![New study set: details](images/user/04-new-study-set.png)

**Step 1: Details**

| Field | Why it matters |
|---|---|
| **Title** (required) | The name of the course or lecture. |
| **Course code**, **Keywords** | Help the AI understand the subject, and help you find the set. |
| **Level** | Introductory, Advanced undergrad or Graduate: sets the depth of explanations and questions. |
| **Exam date** (optional) | Shows a countdown on the study set ("exam in 14d"). |
| **What should we generate?** | Study guide, Flashcards, Quiz, Exercises, Audio recap, AI tutor. You can generate the others later. |
| **Advanced settings** | **Detail level** (concise, standard, detailed, comprehensive), **Citation strictness**, and **Source-only mode** (answers come only from your material) or **Allow external knowledge**. |

**Step 2: Sources.** Drag and drop files or click to browse. Accepted: video (`.mp4`, `.webm`, `.mov`), audio (`.mp3`, `.wav`, `.m4a`), documents (`.pdf`, `.pptx`, `.docx`, `.txt`, `.md`) and images (`.png`, `.jpg`). You can also paste **YouTube links**.

> Recordings of other people require their consent. You confirm you have the right to upload and process each recording.

**Step 3: Processing.** Videos and audio are transcribed, documents are read (scans with OCR), and everything is indexed for search. The study material is generated once **every** source is imported, so it reads the whole course. You can leave the page: progress shows on the Dashboard.

---

## 4. Inside a study set

![Study set overview](images/user/05-study-set.png)

The left panel lists the **tools** (Overview, Sources, Transcript, Study Guide, Flashcards, Quiz, Exercises, Tutor, Analytics) and the **sources**, each with its status (a check mark when ready). **+ Add** adds a source.

The **Overview** shows:
- the classification path (Discipline › Subject › Course › Topic), the level and the exam countdown;
- a card per tool, with **Open** and **Generate** / **Regenerate** / **Add cards**;
- **Ask the grounded tutor**;
- **Recent activity**: every import and generation, with its status;
- the list of sources.

---

## 5. Sources, transcripts and translations

### Sources

![Sources](images/user/06-sources.png)

Each source shows its type (VIDEO, SLIDES, NOTE…), its length and language, and its status (**READY** when imported).
- **↻ Import again** re-reads a source, for example after a failed import.
- **🗑 Delete** removes it, after a confirmation.

Click a source to open it. PDFs and slides are shown page by page; images open full size; Word files are shown as formatted text. At the top, **Import again** and **Delete permanently**. On a source page you can also:

- **Scan with OCR** (PDFs and images): re-reads every page as an image, in the source's language, for scans whose text is missing or garbled. A page keeps its original text when OCR reads it worse.
- **Translate…**: read the source in another language (about 140 languages with the cloud translator, 35 with the local one).
- **Edit**: correct the text, passage by passage (useful after OCR or for a translation). The editor has find and replace, change case, join broken words or lines, tidy spaces, and special characters. Corrections are used by future generations.
- **Read aloud**: listen to the text, passage after passage, with highlighting.

### Transcript

![Transcript](images/user/08-transcript.png)

The transcript of a video or audio source, segment by segment, with timestamps and speakers.
- **Click a timestamp** to play the recording from there.
- **Search the transcript** finds words; **Flagged** shows only segments flagged for checking.
- **EN / FR…** pills switch between the original and its translations. **Translate…** adds a language, **Edit** corrects the shown language, **Read aloud** reads it.
- **Right-click a translation** (its language pill or its text; Shift+F10 from the keyboard) to **Edit** it, **Translate again**, or **Delete** it.

---

## 6. Study guide

![Study guide](images/user/09-study-guide.png)

Structured notes for the whole course: learning goals, prerequisites, vocabulary, key concepts, worked examples, common misconceptions, self-check questions and a summary. Formulas are typeset.

- Every section is labelled **Supported** (backed by your sources) or **Inference** (a reasonable conclusion that the sources do not state).
- The **orange chips** under a section are its citations: a timestamp (`03:34–06:42 Lecture 6`) or a page (`p. 3 lecture06-slides.pdf`). Click one to open the source at that place.
- ✏️ edits a section; ↻ regenerates it. **Regenerate all** rewrites the guide.
- The **style menu** (top right, e.g. *Lecture notes*) changes the guide's form.
- **Audio recap**: **Generate audio** creates a listen-only summary for review on the go.

---

## 7. Flashcards

![Flashcards](images/user/10-flashcards.png)

The deck, with the cards **due** today. Cards are scheduled with **spaced repetition** (FSRS): each one comes back just before you would forget it. **Add cards** generates more.

Click **Review N due** to start a session:

![Reviewing a card](images/user/11-flashcard-review.png)

1. Read the question and try to remember the answer.
2. **Space** (or click) to flip the card: the answer appears with its **source**.
3. Grade yourself honestly: **Again** (blanked), **Hard** (struggled), **Good** (recalled) or **Easy** (instant). Keys 1–4 work too.

← → move between cards. **Suspend this card** removes it from reviews.

---

## 8. Quizzes

![Quizzes](images/user/12-quiz.png)

Quizzes are **adaptive**: questions follow your mastery of each topic. They use eight question types (multiple choice, multi-select, true/false, short answer…). **Generate quiz** creates a new one.

![Taking a quiz](images/user/13-quiz-question.png)

Answer the questions, then **Submit**. Answers are graded on the server and stay hidden until you submit. The results explain why each wrong option is wrong, with citations, and update your mastery per topic.

---

## 9. Exercises

![Exercises](images/user/14-exercises.png)

Exercise sets are longer problems: derivations, code completion, applications. **Work on set** opens one; **Generate exercises** creates another set.

![An exercise](images/user/14b-exercise.png)

Each problem shows its type, whether it is **grounded in source**, an estimated time and its difficulty, then:
- **Prerequisites**, **Assumptions** and **You'll need**, and the **expected format** of the answer;
- **Show hint 1 of 3**: progressive hints, one at a time;
- **Your attempt**: write your reasoning step by step, then **Submit attempt** for feedback against a rubric;
- **Reveal solution**, when you want it;
- the citations (orange chips) of the lecture passages it relies on.

---

## 10. The tutor

![Tutor](images/user/15-tutor.png)

A study partner that answers **from your sources only**, with a citation for every claim. It leads with hints rather than solutions, and says plainly when something is not in your material.

- **New conversation** starts a topic; past conversations are listed on the left. **Right-click a conversation** (or Shift+F10, or its **⋯** button) to **Rename…** it (the title in the list) or **Delete…** it with its messages, after a confirmation.
- **Answer timer**: while the tutor answers, a timer (⏱ HH:MM:SS) counts the time since you sent your question; each answer then shows how long it took, until it was on your screen. **Hover the timer** to see which AI model wrote the answer (for example *Answered by Gemma 4 · local*); while you wait, it shows the model that is answering. The time and the model are saved with the answer, so you find them again in a later session.
- Choose a mode under the conversation: **Ask**, **Hint**, **Explain differently**, **Show source**, **Challenge me** (a small problem on what you just discussed), or **Reveal solution** (it asks you to confirm: solutions stick better after your own attempt).
- Each answer is labelled **Supported** or **Inference**, with its citations (click one to open the lecture at that moment).
- Follow-up questions ("Why?") keep the context of the conversation.
- **Search my sources** (the switch above the modes, on by default): when on, each question is searched in your sources (semantic search) and the tutor answers from the passages it finds, with citations. Turn it **off** to send your question without searching your sources: the tutor answers from general knowledge, the answer is labelled **General knowledge · sources not searched** and has no citations, and **Show source** is unavailable. The switch is remembered for each study set in this browser. General knowledge may use different notation or conventions than your course: turn the search back on to check against your material.
- For a graded assignment, the tutor guides you through the reasoning instead of giving the answer.

---

## 11. Analytics

![Analytics](images/user/16-analytics.png)

- **Predicted retention** of your flashcards, **cards due now**, **time studied** and your **weakest topics** (under 50 % mastery).
- **What to do next**: recommendations, each with the data it is based on (for example *"Your mastery of … is 0 % across 19 attempts"*) and a link to act on it: a quiz on that topic, the due cards, or the tutor.
- **Topic mastery**, with a trend arrow, and **accuracy by difficulty**.

Mastery is a running average of your graded attempts: it rises as you answer correctly. Use it to see which topics need work before the exam.

---

## 12. Explore

![Explore](images/user/17-explore.png)

Your courses filed in a shared catalogue: **Discipline › Subject › Course / Module › Topic**.

- **Has courses** hides empty branches (on by default).
- **Search topics or courses** filters the tree. The ➤ button opens a search window: type any part of a name, choose a result, and the tree opens at it.
- **Expand all** / **Collapse all**.
- A course appears under its main topic and, marked *related*, under its related topics.

---

## 13. Settings and your data

![Settings](images/user/18-settings.png)

- **Appearance**: theme and reading comfort for long study sessions.
- **Your data**: you own your content. **Export everything › Download export** downloads a JSON archive of your study sets, transcripts, cards, quizzes, attempts and progress. **Delete account** removes your account, every uploaded source and all generated material, permanently: type “DELETE MY ACCOUNT” to confirm.

Your study sets are private: nobody else sees them.

---

## 14. PolyLingue: learning a language

Open **PolyLingue** from the Dashboard. Short lessons, instant correction, audio and spaced review, ten minutes a day.

![PolyLingue](images/user/20-polylingue-home.png)

The left panel lists **your languages** (for example *English · A2*), **Keep going** (Badges, Leagues, Weekly summary, Reminders, My classes) and, for the language you are in, **Practise** (Lessons, Reading, Listening, Writing, Speaking, Weak words, Review).

### Adding a language

**Add a language** asks four things: your **level**, the **language**, the language of the **explanations**, and your **daily goal**.

![Choosing a level](images/user/21-add-language.png)

Levels follow the European scale, A1 (beginner) to C2 (proficient). From B2 the course is taught entirely in the language you learn. Not sure of your level? **Take the 5-minute placement test.**

### The course page

![Course page](images/user/22-course.png)

- Your level, XP, words learned, **streak** (days in a row) and streak freezes; the ring shows today's minutes against your goal.
- **Continue** starts the next lesson; **Review** practises what is due; **Progress** shows your history.
- **Available offline**: **Save the next lessons** keeps the next three lessons and their audio on this device, for practice without internet. Turn on **Keep up to date** to keep them current.
- **Learn from your own material**: **Make a lesson** turns a lecture, document or video from your study sets into a lesson at your level.
- Below, the units and their lessons.

### Lessons

![Starting a lesson](images/user/23-lesson-start.png)

A lesson starts with its new words, then a series of short exercises.

![An exercise](images/user/24-lesson-exercise.png)

- Choose or type your answer, then **Check**. Number keys choose options.
- 🔊 plays the audio, 🐢 plays it slowly.
- **Hint** helps, for half the XP.
- The bar at the top shows your progress; the star counts the XP earned.

![Feedback](images/user/25-lesson-feedback.png)

After each answer you see whether it was right, the correct answer and an explanation. If an exercise looks wrong, **Report a problem** (wrong answer, unclear question, mistake, wrong audio…) with an optional comment. An exercise reported by several learners is set aside until an administrator reviews it.

### Changing level

Right-click your language in the left panel (or select it and press Shift+F10):

![Language menu](images/user/26-language-menu.png)

**Change level…** lists every level of the same language, with whether its course is ready or will be written for you:

![Change level](images/user/27-change-level.png)

Your XP, words, streak and badges stay. If you choose a level nobody has started yet, its course is written first (this takes a few minutes).

### Practice: reading, listening, writing, speaking

![Practice list](images/user/31-practice-list.png)

Each skill has its own practice sessions on the topics of your course.

![Reading](images/user/30-reading.png)

- **Reading**: a text at your level. **Listen to the text** reads it aloud; tap an underlined word to see its meaning; then answer the questions and **Check**.
- **Listening**: a recording with questions; replay it as often as you need.
- **Writing**: write a short text; it is corrected with explanations.
- **Speaking**: listen, then say the sentence; or answer a question aloud.

![Speaking](images/user/28-speaking.png)

In **Speaking**, click **Record**, speak, and stop: what was heard is shown with a score. Your answers are kept: under each item, **My latest** and **My best** (the highest score) play back your recording. You can save one as a `.wav` file, or delete it with the 🗑 button. **Delete them** removes all of a practice's recordings.

**Micro settings** (top right of the card) chooses the microphone and tests it:

![Micro settings](images/user/29-micro-settings.png)

- **Microphone**: which one to use.
- **Input level**: green while you speak; red means too loud (move back a little).
- **Noise suppression**, **Echo cancellation** (useful with speakers instead of headphones), **Automatic volume**.
- **Test: record 3 seconds**, then play it back.

The settings are saved in this browser. If recording is blocked, the message says what to do: allow the microphone in the browser's site settings, connect a microphone, or close the app that is using it. Some embedded browser windows never allow the microphone: open LearningForge in Chrome, Edge or Firefox.

### Progress, review and weak words

![Progress](images/user/32-progress.png)

- **Progress**: XP, streak (and streak freezes, earned with XP), lessons done, active days, words learned and **words mastered** (remembered for three weeks or more), accuracy, your daily goal, **accuracy by skill** (lessons, reading, listening, writing, speaking, weak words) and a calendar of the last five weeks.
- **Review**: practises the words and exercises due, with spaced repetition.

![Review](images/user/33-review.png)

- **Weak words**: the words you miss most often, to practise on their own.

### Keep going: badges, leagues, summary, reminders

![Badges](images/user/34-badges.png)

- **Badges** reward streaks, lessons and skills.
- **Leagues** compare this week's XP with friends: **New league** creates one and gives a code to share; **Join with a code** joins a friend's. Members see only your nickname and weekly XP.

![Leagues](images/user/35-leagues.png)

- **Weekly summary**: what you did this week.

![Weekly summary](images/user/36-weekly-summary.png)

- **Reminders**: a **daily reminder** at the time you choose (when today's goal is not reached yet), **streak at risk** in the evening, and the **weekly summary** on Monday. Check the **time zone** (*Use this device's* sets yours). Reminders appear at the top of PolyLingue; allow **browser notifications** to get them even when PolyLingue is closed.

![Reminders](images/user/37-reminders.png)

### Classes

If your teacher gives you a class code, open **My classes** and **Join a class**:

![My classes](images/user/38-my-classes.png)

Type the code (for example `YRY-A8S`) and **Continue**. You see the class, its teacher and what the teacher will see before you join:

![Joining a class](images/user/39-join-class.png)

Your teacher sees your activity in the class's language: minutes, XP, lessons, practice and assignments. Assignments appear first on your course page, with their due date.

---

## 15. Tips and questions

- **Study a little every day.** Flashcards and PolyLingue reviews are scheduled for the day you are about to forget; ten minutes a day beats an hour once a week.
- **Check the citations.** Every claim links to its source; an *Inference* label means the sources do not state it directly.
- **Correct, then regenerate.** Fixing a transcript or OCR text improves everything generated afterwards.
- **A source stays "processing" for a long time?** Long videos take a while to transcribe. If it fails, use **Import again** on the Sources page.
- **The tutor says it does not know.** The answer is probably not in your sources: add the right material, or ask your administrator whether external knowledge is allowed for the set.
- **Something looks wrong?** In PolyLingue, use **Report a problem**. Elsewhere, tell your administrator.
