"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, Mic, Plus, Snail, Square, Trophy, Volume2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { SpeakButtons } from "@/components/polylingue/speak";
import {
  practiceAudioSrc,
  useAddWord,
  useCompletePractice,
  usePracticeAnswer,
  useSpeakingCheck,
  useWritingCorrection,
  type Correction,
  type PlayerPracticeContent,
  type SkillSlug,
  type SpeakingResult,
} from "@/hooks/use-polylingue";
import type { Verdict } from "@/lib/polylingue/check";

type Reading = Extract<PlayerPracticeContent, { skill: "READING" }>;
type Listening = Extract<PlayerPracticeContent, { skill: "LISTENING" }>;
type Writing = Extract<PlayerPracticeContent, { skill: "WRITING" }>;
type Speaking = Extract<PlayerPracticeContent, { skill: "SPEAKING" }>;

interface Common {
  courseId: string;
  practiceId: string;
  lang: string;
}

// ------------------------------------------------------------------ shared

let currentAudio: HTMLAudioElement | null = null;
/** Plays a list of clips one after the other (normal or slow); resolves when done or stopped. */
function playClips(urls: string[], slow: boolean, onIndex?: (i: number) => void): () => void {
  let stopped = false;
  currentAudio?.pause();
  const play = (i: number) => {
    if (stopped || i >= urls.length) {
      onIndex?.(-1);
      return;
    }
    onIndex?.(i);
    const a = new Audio(urls[i]);
    a.playbackRate = slow ? 0.75 : 1;
    currentAudio = a;
    a.onended = () => play(i + 1);
    a.onerror = () => {
      toast.error("Audio unavailable: check the text-to-speech settings in Admin → AI model.");
      onIndex?.(-1);
    };
    void a.play().catch(() => undefined);
  };
  play(0);
  return () => {
    stopped = true;
    currentAudio?.pause();
    onIndex?.(-1);
  };
}

function useFinish(courseId: string, practiceId: string, skill: SkillSlug) {
  const complete = useCompletePractice(courseId, practiceId, skill);
  const startedAt = useRef(Date.now());
  const [done, setDone] = useState<{ score: number; bonusXp: number; reveal: { dictation: string[]; passage: string[] } | null } | null>(null);
  async function finish(score: number) {
    try {
      setDone(await complete.mutateAsync({ score, seconds: (Date.now() - startedAt.current) / 1000 }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    }
  }
  return { finish, done, saving: complete.isPending };
}

function Done({ courseId, skill, score, xp, children }: { courseId: string; skill: SkillSlug; score: number; xp: number; children?: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="space-y-3 p-6 text-center">
        <Trophy className="mx-auto h-10 w-10 text-amber-500" aria-hidden="true" />
        <p className="text-lg font-semibold">Practice complete: {score}%</p>
        <p className="text-sm text-muted-foreground">+{xp} XP</p>
        {children}
        <Button asChild>
          <Link href={`/polylingue/${courseId}/practice/${skill}`}>Back to {skill}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function VerdictLine({ verdict, expected, note, explanation, xp }: { verdict: Verdict; expected: string; note?: string; explanation?: string; xp: number }) {
  return (
    <div
      className={cn(
        "space-y-1 rounded-md border p-3 text-sm",
        verdict === "correct" ? "border-emerald-500/50 bg-emerald-500/10" : verdict === "almost" ? "border-amber-500/50 bg-amber-500/10" : "border-red-500/50 bg-red-500/10",
      )}
      role="status"
    >
      <p className="flex items-center gap-2 font-medium">
        {verdict === "wrong" ? <XCircle className="h-4 w-4 text-red-600" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />}
        {verdict === "correct" ? "Correct" : verdict === "almost" ? `Almost${note ? `: ${note}` : ""}` : "Not quite"}
        {xp > 0 && <span className="ml-auto text-xs text-amber-600">+{xp} XP</span>}
      </p>
      {verdict !== "correct" && (
        <p>
          Answer: <span className="font-semibold">{expected}</span>
        </p>
      )}
      {explanation && <p className="text-muted-foreground">{explanation}</p>}
    </div>
  );
}

/** Comprehension questions (reading, listening): one answer each, corrected at once. */
function Questions({
  questions,
  onAnswer,
  results,
}: {
  questions: { question: string; options: string[] }[];
  onAnswer: (index: number, answer: string) => Promise<void>;
  results: Record<number, { verdict: Verdict; expected: string; explanation: string; xp: number }>;
}) {
  const [chosen, setChosen] = useState<Record<number, string>>({});
  const [pending, setPending] = useState<number | null>(null);
  return (
    <ol className="space-y-4">
      {questions.map((q, i) => (
        <li key={i} className="space-y-2">
          <p className="text-sm font-medium">
            {i + 1}. {q.question}
          </p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {q.options.map((o) => (
              <button
                key={o}
                type="button"
                disabled={Boolean(results[i])}
                onClick={() => setChosen((c) => ({ ...c, [i]: o }))}
                className={cn(
                  "rounded-md border p-2 text-left text-sm transition-colors disabled:cursor-default",
                  chosen[i] === o ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:bg-muted/50",
                  results[i] && results[i].expected === o && "border-emerald-500/60 bg-emerald-500/10",
                )}
              >
                {o}
              </button>
            ))}
          </div>
          {results[i] ? (
            <VerdictLine {...results[i]} />
          ) : (
            <Button
              size="sm"
              disabled={!chosen[i] || pending === i}
              onClick={async () => {
                setPending(i);
                await onAnswer(i, chosen[i]);
                setPending(null);
              }}
            >
              {pending === i && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
              Check
            </Button>
          )}
        </li>
      ))}
    </ol>
  );
}

const pointsOf = (v: Verdict) => (v === "correct" ? 1 : v === "almost" ? 0.5 : 0);

// ----------------------------------------------------------------- reading

export function ReadingPlayer({ courseId, practiceId, lang, content }: Common & { content: Reading }) {
  const answer = usePracticeAnswer(courseId, practiceId);
  const addWord = useAddWord(courseId);
  const { finish, done, saving } = useFinish(courseId, practiceId, "reading");
  const [results, setResults] = useState<Record<number, { verdict: Verdict; expected: string; explanation: string; xp: number }>>({});
  const [word, setWord] = useState<{ term: string; meaning: string } | null>(null);
  const [reading, setReading] = useState(-1);
  const stopRef = useRef<(() => void) | null>(null);
  const sentences = useMemo(() => content.text.match(/[^.!?…]+[.!?…]*["»”]?\s*/g)?.map((s) => s.trim()).filter(Boolean) ?? [content.text], [content.text]);
  const xp = Object.values(results).reduce((n, r) => n + r.xp, 0);
  const allAnswered = Object.keys(results).length === content.questions.length;

  // Glossary words are underlined in the text; a tap shows the meaning.
  const parts = useMemo(() => {
    const terms = [...content.glossary].sort((a, b) => b.term.length - a.term.length);
    if (!terms.length) return [{ text: content.text }];
    const escaped = terms.map((t) => t.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const re = new RegExp(`(${escaped.join("|")})`, "giu");
    return content.text.split(re).map((piece) => {
      const g = terms.find((t) => t.term.toLowerCase() === piece.toLowerCase());
      return g ? { text: piece, gloss: g } : { text: piece };
    });
  }, [content]);

  useEffect(() => () => stopRef.current?.(), []);

  if (done) return <Done courseId={courseId} skill="reading" score={done.score} xp={xp + done.bonusXp} />;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">{content.title}</h2>
            <span className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  if (reading >= 0) return stopRef.current?.();
                  stopRef.current = playClips(
                    sentences.map((s) => `/api/polylingue/speech?lang=${encodeURIComponent(lang)}&text=${encodeURIComponent(s)}`),
                    false,
                    setReading,
                  );
                }}
              >
                {reading >= 0 ? <Square className="h-3.5 w-3.5" aria-hidden="true" /> : <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />}
                {reading >= 0 ? "Stop" : "Listen to the text"}
              </Button>
            </span>
          </div>
          <p className="whitespace-pre-line text-base leading-relaxed">
            {parts.map((p, i) =>
              "gloss" in p && p.gloss ? (
                <button
                  key={i}
                  type="button"
                  onClick={() => setWord(p.gloss!)}
                  className="rounded underline decoration-primary/50 decoration-dotted underline-offset-4 hover:bg-primary/10"
                >
                  {p.text}
                </button>
              ) : (
                <span key={i}>{p.text}</span>
              ),
            )}
          </p>
          {word && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm" role="status">
              <SpeakButtons lang={lang} text={word.term} size="sm" />
              <span className="font-semibold">{word.term}</span>
              <span className="text-muted-foreground">· {word.meaning}</span>
              <Button
                size="sm"
                variant="outline"
                className="ml-auto gap-1"
                disabled={addWord.isPending}
                onClick={async () => {
                  const r = await addWord.mutateAsync({ term: word.term, translation: word.meaning });
                  toast.success(r.added ? `"${word.term}" added to your review` : "Already in your review");
                }}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Review
              </Button>
            </div>
          )}
          <p className="text-xs text-muted-foreground">Tap an underlined word to see its meaning.</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-5">
          <h3 className="text-sm font-semibold">Questions</h3>
          <Questions
            questions={content.questions}
            results={results}
            onAnswer={async (index, given) => {
              try {
                const r = await answer.mutateAsync({ part: "question", index, answer: given });
                setResults((x) => ({ ...x, [index]: r }));
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Could not check");
              }
            }}
          />
          {allAnswered && (
            <Button
              className="w-full"
              size="lg"
              disabled={saving}
              onClick={() => void finish((Object.values(results).reduce((n, r) => n + pointsOf(r.verdict), 0) / content.questions.length) * 100)}
            >
              Finish
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// --------------------------------------------------------------- listening

export function ListeningPlayer({ courseId, practiceId, content }: Common & { content: Listening }) {
  const answer = usePracticeAnswer(courseId, practiceId);
  const { finish, done, saving } = useFinish(courseId, practiceId, "listening");
  const [dictation, setDictation] = useState<Record<number, { verdict: Verdict; expected: string; note?: string; xp: number }>>({});
  const [typed, setTyped] = useState<Record<number, string>>({});
  const [results, setResults] = useState<Record<number, { verdict: Verdict; expected: string; explanation: string; xp: number }>>({});
  const [playing, setPlaying] = useState(-1);
  const stopRef = useRef<(() => void) | null>(null);
  useEffect(() => () => stopRef.current?.(), []);

  const xp = [...Object.values(dictation), ...Object.values(results)].reduce((n, r) => n + r.xp, 0);
  const allAnswered = Object.keys(dictation).length === content.dictationCount && Object.keys(results).length === content.questions.length;
  const passageUrls = Array.from({ length: content.passageCount }, (_, i) => practiceAudioSrc(courseId, practiceId, "passage", i));

  if (done) {
    return (
      <Done courseId={courseId} skill="listening" score={done.score} xp={xp + done.bonusXp}>
        {done.reveal && (
          <div className="space-y-1 rounded-md bg-muted/50 p-3 text-left text-sm">
            <p className="font-medium">Transcript</p>
            {done.reveal.passage.map((s, i) => (
              <p key={i}>{s}</p>
            ))}
          </div>
        )}
      </Done>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-4 p-5">
          <h3 className="text-sm font-semibold">1. Dictation: write what you hear</h3>
          <ol className="space-y-3">
            {Array.from({ length: content.dictationCount }, (_, i) => (
              <li key={i} className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">{i + 1}.</span>
                  <button
                    type="button"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary hover:bg-primary/20"
                    aria-label="Listen"
                    onClick={() => (stopRef.current = playClips([practiceAudioSrc(courseId, practiceId, "dictation", i)], false))}
                  >
                    <Volume2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
                    aria-label="Listen slowly"
                    onClick={() => (stopRef.current = playClips([practiceAudioSrc(courseId, practiceId, "dictation", i)], true))}
                  >
                    <Snail className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <form
                    className="flex flex-1 gap-2"
                    onSubmit={async (ev) => {
                      ev.preventDefault();
                      if (!typed[i]?.trim() || dictation[i]) return;
                      try {
                        const r = await answer.mutateAsync({ part: "dictation", index: i, answer: typed[i] });
                        setDictation((d) => ({ ...d, [i]: r }));
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : "Could not check");
                      }
                    }}
                  >
                    <Input
                      value={typed[i] ?? ""}
                      onChange={(ev) => setTyped((t) => ({ ...t, [i]: ev.target.value }))}
                      disabled={Boolean(dictation[i])}
                      placeholder="Type what you hear"
                      aria-label={`Sentence ${i + 1}`}
                      autoComplete="off"
                      spellCheck={false}
                    />
                    {!dictation[i] && (
                      <Button type="submit" size="sm" disabled={!typed[i]?.trim()}>
                        Check
                      </Button>
                    )}
                  </form>
                </div>
                {dictation[i] && <VerdictLine {...dictation[i]} />}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">2. {content.title}</h3>
            <span className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => (playing >= 0 ? stopRef.current?.() : (stopRef.current = playClips(passageUrls, false, setPlaying)))}
              >
                {playing >= 0 ? <Square className="h-3.5 w-3.5" aria-hidden="true" /> : <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />}
                {playing >= 0 ? `Stop (${playing + 1}/${content.passageCount})` : "Play the recording"}
              </Button>
              <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => (stopRef.current = playClips(passageUrls, true, setPlaying))} disabled={playing >= 0}>
                <Snail className="h-3.5 w-3.5" aria-hidden="true" /> Slowly
              </Button>
            </span>
          </div>
          <p className="text-xs text-muted-foreground">Listen as many times as you like; the transcript appears at the end.</p>
          <Questions
            questions={content.questions}
            results={results}
            onAnswer={async (index, given) => {
              try {
                const r = await answer.mutateAsync({ part: "question", index, answer: given });
                setResults((x) => ({ ...x, [index]: r }));
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Could not check");
              }
            }}
          />
          {allAnswered && (
            <Button
              className="w-full"
              size="lg"
              disabled={saving}
              onClick={() => {
                const all = [...Object.values(dictation), ...Object.values(results)];
                void finish((all.reduce((n, r) => n + pointsOf(r.verdict), 0) / all.length) * 100);
              }}
            >
              Finish and see the transcript
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ----------------------------------------------------------------- writing

function CorrectionView({ c, model }: { c: Correction; model?: string }) {
  return (
    <div className="space-y-3 rounded-md border border-border p-3 text-sm">
      <div className="flex items-center gap-2">
        <Badge className={cn(c.score >= 70 ? "bg-emerald-600" : c.score >= 40 ? "bg-amber-500" : "bg-red-600", "text-white")}>{c.score}/100</Badge>
        <p className="text-muted-foreground">{c.feedback}</p>
      </div>
      {c.corrections.length > 0 && (
        <ul className="space-y-1.5">
          {c.corrections.map((x, i) => (
            <li key={i}>
              <span className="text-red-600 line-through">{x.original}</span> → <span className="font-medium text-emerald-700 dark:text-emerald-400">{x.corrected}</span>
              {x.explanation && <span className="block text-xs text-muted-foreground">{x.explanation}</span>}
            </li>
          ))}
        </ul>
      )}
      <div>
        <p className="text-xs font-medium text-muted-foreground">Corrected</p>
        <p className="whitespace-pre-line">{c.corrected}</p>
      </div>
      {model && (
        <details>
          <summary className="cursor-pointer text-xs font-medium text-primary">Model answer</summary>
          <p className="mt-1 whitespace-pre-line text-muted-foreground">{model}</p>
        </details>
      )}
    </div>
  );
}

export function WritingPlayer({ courseId, practiceId, content }: Common & { content: Writing }) {
  const correct = useWritingCorrection(courseId, practiceId);
  const { finish, done, saving } = useFinish(courseId, practiceId, "writing");
  const [texts, setTexts] = useState<Record<number, string>>({});
  const [results, setResults] = useState<Record<number, Correction & { xp: number; model: string }>>({});
  const [pending, setPending] = useState<number | null>(null);
  const xp = Object.values(results).reduce((n, r) => n + r.xp, 0);
  const count = (s = "") => s.trim().split(/\s+/).filter(Boolean).length;

  if (done) return <Done courseId={courseId} skill="writing" score={done.score} xp={xp + done.bonusXp} />;

  return (
    <div className="space-y-4">
      {content.tasks.map((t, i) => (
        <Card key={i}>
          <CardContent className="space-y-3 p-5">
            <p className="text-sm font-medium">
              {i + 1}. {t.prompt}
            </p>
            {t.hints.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {t.hints.map((h) => (
                  <Badge key={h} variant="outline" className="font-normal">
                    {h}
                  </Badge>
                ))}
              </div>
            )}
            <Textarea
              rows={6}
              value={texts[i] ?? ""}
              onChange={(e) => setTexts((x) => ({ ...x, [i]: e.target.value }))}
              disabled={Boolean(results[i])}
              placeholder="Write your answer…"
              aria-label={`Answer to task ${i + 1}`}
              spellCheck={false}
            />
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className={cn(count(texts[i]) < t.minWords || count(texts[i]) > t.maxWords ? "text-amber-600" : "text-emerald-600")}>
                {count(texts[i])} words · aim for {t.minWords}–{t.maxWords}
              </span>
              {!results[i] && (
                <Button
                  size="sm"
                  disabled={!texts[i]?.trim() || pending === i}
                  onClick={async () => {
                    setPending(i);
                    try {
                      const r = await correct.mutateAsync({ index: i, text: texts[i] });
                      setResults((x) => ({ ...x, [i]: r }));
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Could not correct");
                    } finally {
                      setPending(null);
                    }
                  }}
                >
                  {pending === i && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                  {pending === i ? "Correcting…" : "Submit for correction"}
                </Button>
              )}
            </div>
            {results[i] && <CorrectionView c={results[i]} model={results[i].model} />}
          </CardContent>
        </Card>
      ))}
      {Object.keys(results).length === content.tasks.length && (
        <Button className="w-full" size="lg" disabled={saving} onClick={() => void finish(Object.values(results).reduce((n, r) => n + r.score, 0) / content.tasks.length)}>
          Finish
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- speaking

/** Records from the microphone until stopped (or `maxSeconds`), then hands over the audio. */
function useRecorder(maxSeconds: number) {
  const [recording, setRecording] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  async function start(onDone: (audio: Blob) => void) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
      const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: BlobPart[] = [];
      r.ondataavailable = (e) => chunks.push(e.data);
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        if (timer.current) clearTimeout(timer.current);
        onDone(new Blob(chunks, { type: r.mimeType || "audio/webm" }));
      };
      recorder.current = r;
      r.start();
      setRecording(true);
      timer.current = setTimeout(() => r.state === "recording" && r.stop(), maxSeconds * 1000);
    } catch {
      toast.error("Microphone unavailable: allow microphone access for this site.");
    }
  }
  function stop() {
    if (recorder.current?.state === "recording") recorder.current.stop();
  }
  useEffect(() => () => stop(), []);
  return { recording, start, stop };
}

function RecordButton({ maxSeconds, busy, onAudio }: { maxSeconds: number; busy: boolean; onAudio: (audio: Blob) => void }) {
  const { recording, start, stop } = useRecorder(maxSeconds);
  return (
    <Button
      variant={recording ? "destructive" : "default"}
      size="sm"
      className="gap-1.5"
      disabled={busy}
      onClick={() => (recording ? stop() : void start(onAudio))}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : recording ? <Square className="h-3.5 w-3.5" aria-hidden="true" /> : <Mic className="h-3.5 w-3.5" aria-hidden="true" />}
      {busy ? "Listening to you…" : recording ? "Stop" : "Record"}
    </Button>
  );
}

export function SpeakingPlayer({ courseId, practiceId, lang, content }: Common & { content: Speaking }) {
  const check = useSpeakingCheck(courseId, practiceId);
  const { finish, done, saving } = useFinish(courseId, practiceId, "speaking");
  const [results, setResults] = useState<Record<string, SpeakingResult>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const total = content.sentences.length + content.questions.length;
  const xp = Object.values(results).reduce((n, r) => n + r.xp, 0);

  async function send(kind: "sentence" | "question", index: number, audio: Blob) {
    const key = `${kind}-${index}`;
    setBusy(key);
    try {
      const r = await check.mutateAsync({ kind, index, audio });
      setResults((x) => ({ ...x, [key]: r }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not check your speech");
    } finally {
      setBusy(null);
    }
  }

  if (done) return <Done courseId={courseId} skill="speaking" score={done.score} xp={xp + done.bonusXp} />;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-4 p-5">
          <h3 className="text-sm font-semibold">1. Listen, then say the sentence</h3>
          <ol className="space-y-4">
            {content.sentences.map((s, i) => {
              const r = results[`sentence-${i}`];
              return (
                <li key={i} className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <SpeakButtons lang={lang} text={s.text} size="sm" />
                    <span className="flex-1 text-base font-medium">{s.text}</span>
                    <RecordButton maxSeconds={20} busy={busy === `sentence-${i}`} onAudio={(a) => void send("sentence", i, a)} />
                  </div>
                  <p className="text-xs text-muted-foreground">{s.meaning}</p>
                  {r && r.kind === "sentence" && (
                    <div className={cn("rounded-md border p-2 text-sm", r.score >= 85 ? "border-emerald-500/50 bg-emerald-500/10" : r.score >= 50 ? "border-amber-500/50 bg-amber-500/10" : "border-red-500/50 bg-red-500/10")} role="status">
                      <p>
                        <span className="font-semibold">{r.score}%</span> · I heard: <span className="italic">{r.heard || "(nothing)"}</span>
                        {r.xp > 0 && <span className="ml-2 text-xs text-amber-600">+{r.xp} XP</span>}
                      </p>
                      {r.missed.length > 0 && <p className="text-xs text-muted-foreground">Missed or unclear: {r.missed.join(", ")} (record again to improve)</p>}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-5">
          <h3 className="text-sm font-semibold">2. Answer aloud</h3>
          {content.questions.map((q, i) => {
            const r = results[`question-${i}`];
            return (
              <div key={i} className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="flex-1 text-sm font-medium">{q.prompt}</p>
                  <RecordButton maxSeconds={60} busy={busy === `question-${i}`} onAudio={(a) => void send("question", i, a)} />
                </div>
                {r && r.kind === "question" && (
                  <div className="space-y-2">
                    <p className="text-sm">
                      I heard: <span className="italic">{r.heard || "(nothing)"}</span>
                    </p>
                    {r.heard && <CorrectionView c={r} model={r.model} />}
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {Object.keys(results).length >= total && (
        <Button
          className="w-full"
          size="lg"
          disabled={saving}
          onClick={() => void finish(Object.values(results).reduce((n, r) => n + r.score, 0) / Object.values(results).length)}
        >
          Finish
        </Button>
      )}
    </div>
  );
}
