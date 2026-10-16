# Assessment — text-to-speech models, and design for bilingual sources (FR ⇄ EN)

_Date: 2026-10-16 · Scope: assessment and design (since built) · Measured on: GTX 1080 Ti, local Speaches server (Docker `curiosity-stt-1`)_

## Verdict

- **TTS model selector (admin → AI model):**

  | | Model | Notes |
  |---|---|---|
  | Local (default) | **Kokoro-82M** | English: 28 voices, the most natural local option |
  | Local | **Piper** | French: 7 voices, the fastest local option; English too |
  | Cloud | **Azure Neural TTS** | Best French voices |
  | Cloud | **Gemini 3.8 Flash-Lite TTS** | Cheapest cloud option, 100+ languages |

  The local models run in the Speaches server you already use for Whisper, and they are already downloaded.
- **Translator selector:** **Gemma 4 via Ollama** (local, free, private) or **Azure AI Translator** (cloud: fast, consistent terminology, about $10 per 1M characters, free tier available).
- **Bilingual sources:**
  - each French passage and transcript segment gets an English translation stored next to it, with the same page and timestamps;
  - both languages are embedded and searchable;
  - students switch FR / EN on the source and transcript pages and can **play** the transcript in either language;
  - audio is generated per segment on first play, then cached.

## 1. Text-to-speech — measured and published figures

Test: the same 3 sentences about candlesticks (about 14.5 s of speech), French and English. Samples were sent in the conversation.

| Model | Where | Voices FR / EN | Synthesis time for 14.5 s of speech (warm) | Speed vs. real time | Cost | Quality (listen to the samples) |
|---|---|---|---|---|---|---|
| **Kokoro-82M v1.0** (ONNX fp16) | Local, Speaches | 1 (`ff_siwis`) / 28 (US + UK) | 9.7–10.0 s | 1.5× | free | Very natural in English; French correct but a single voice |
| **Piper fr_FR-siwis-medium** | Local, Speaches | 7 FR voices (siwis, tom, upmc, gilles…) / many EN | **3.8 s** | **3.8×** | free | Clear, slightly robotic; fast |
| Piper fr_FR-tom-medium | Local, Speaches | (male voice) | 7.1 s | 2× | free | Clear male voice |
| **Azure Neural TTS** | Cloud (EU regions) | many FR (fr-FR, fr-CA…) / many EN | typically real-time streaming | — | **$15 per 1M characters** (HD $22); **0.5M characters free per month** | Studio quality, the best French |
| **Gemini 3.8 Flash-Lite TTS** | Cloud | 100+ languages, auto-detected | real-time | — | $0.50 per 1M input tokens + $6 per 1M audio tokens, **≈ $0.0015 per 10 s (≈ $0.54 per hour)** until 2026-12-31, then double | Expressive, very good |
| Gemini 3.8 Flash TTS (reference) | Cloud | 130+ languages | real-time | — | ≈ $0.00225 per 10 s (≈ $0.81 per hour) | Studio-grade |
| Gemma 4 | — | — | — | — | — | **Cannot produce speech** (text-only model), so it is not a TTS option |

**What it costs to read a course aloud.** One hour of speech is about 9,000 words, or about 55,000 characters:
- Azure Neural: about $0.80 (the free tier covers about 9 hours per month);
- Gemini Flash-Lite TTS: about $0.54;
- local models: free, but slower than real time on Kokoro.

That speed is why audio is generated **per segment, on demand, and cached**: the first segment plays within seconds, the following ones are prepared while it plays, and nothing is generated twice.

**Recommendation:**
- Default to **Kokoro for English** and **Piper siwis for French**: local, free and private.
- Offer **Azure** when French quality matters most, and **Gemini Flash-Lite TTS** as the cheapest cloud option. Gemini uses your existing `GEMINI_API_KEY`; Azure needs `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION`.

## 2. Translator models

| Model | Where | Speed | Cost | Notes |
|---|---|---|---|---|
| **Gemma 4 (Ollama)** | Local | about 5–50 s per passage on the GTX 1080 Ti | free | Private, good quality, slow for long lectures (a 1-hour transcript is about 40 passages, so roughly 5–20 min) |
| **Azure AI Translator** | Cloud | under a second per passage | **$10 per 1M characters**, free tier available | Consistent terminology; needs `AZURE_TRANSLATOR_KEY` and `AZURE_TRANSLATOR_REGION` |

For scale: the French material in *Trading – From Basics to advanced* is about 30,000 characters, about $0.30 with Azure.

## 3. Design (built — see CHANGELOG "Unreleased")

**Admin → AI model tab: two new cards**
- **Translator model:** Gemma 4 (local) or Azure AI Translator, with a "Test translation" button.
- **TTS model:** Kokoro (local), Piper (local), Azure Neural TTS or Gemini 3.8 Flash-Lite TTS, with a **voice per language** (FR and EN) and a "Play sample" button.
- Like the AI model, the choices are stored in `app_settings`; keys stay in `.env`.

**Import pipeline**
1. **Detect the language.** Whisper already reports it for audio and video; documents use a fast detector on the extracted text.
2. **If French:** translate every passage, and for audio/video every transcript segment, to English with the selected translator. Keep the page, the timestamps and the citation anchors.
3. **Store both languages.**
   - `extracted_chunks` gets a `language` column. The English passage is a sibling row (`translationOfId`) with its **own embedding**, so English questions match English text and French questions match French text.
   - Transcript segments get an English text alongside the French.
4. **Search:** both languages are indexed; duplicates of the same passage collapse to one, in the language of the question or the student's choice. Citations always point at the original.
5. **Import gate:** generation waits until the translation is done too, like the other import steps.

**Student experience**
- **Language switch:** FR / EN on the source viewer, the transcript page and the tutor's citations.
- **Play:** reads the transcript (or document text) aloud in the chosen language. Each segment is highlighted while it plays, and clicking a segment starts from there.
- **Storage:** audio is stored per segment and voice under the source's own storage folder, so deleting the source deletes it.
- **Original recordings:** they keep their own player; "Play" adds a read-aloud track, so the English version of a French lecture becomes listenable.

**Data protection:** with Azure or Gemini selected, source text leaves the machine, so the same warning as the cloud AI models appears.

**Estimated effort:** about 2–3 days with tests. Translator and bilingual storage come first, then the viewer switch, then TTS playback.

## 4. Decisions needed
1. **Default voices:** Kokoro `af_heart` (EN) and Piper `siwis` (FR)? Listen to the samples.
2. **Azure:** create a Speech and/or Translator resource (EU region) and put the keys in `.env`, or start local-only and add Azure later?
3. **Existing French sources:** translate them all once the feature lands? Yes would be a one-off of about 30k characters for the Trading courses.
