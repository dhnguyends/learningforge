"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, AudioLines, BarChart3, ChevronRight, EyeOff, Flag, Loader2, Pencil, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { targetLanguage } from "@/lib/polylingue/levels";
import { LangBadge } from "@/components/polylingue/lang-badge";
import {
  useAdminCurricula,
  useAdminCurriculum,
  useDismissReports,
  usePolyAnalytics,
  usePregenerateAudio,
  useReportQueue,
  useSaveVoices,
  useVoices,
} from "@/hooks/use-polylingue-admin";

const REASON: Record<string, string> = { wrong_answer: "wrong answer", unclear: "unclear", audio: "audio", typo: "typo", other: "other" };

/** Admin › PolyLingue: review the AI-written lessons, learners' reports, analytics, and the voices. */
export function PolylingueAdmin() {
  const [tab, setTab] = useState("content");
  const { data: reports } = useReportQueue();
  const open = reports?.reports.length ?? 0;
  return (
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList>
        <TabsTrigger value="content">Content</TabsTrigger>
        <TabsTrigger value="reports" className="gap-1.5">
          Reports
          {open > 0 && <Badge className="h-5 min-w-5 justify-center px-1 text-[10px]">{open}</Badge>}
        </TabsTrigger>
        <TabsTrigger value="analytics">Analytics</TabsTrigger>
        <TabsTrigger value="voices">Voices &amp; audio</TabsTrigger>
      </TabsList>
      <TabsContent value="content" className="mt-4">
        <ContentPanel />
      </TabsContent>
      <TabsContent value="reports" className="mt-4">
        <ReportsPanel />
      </TabsContent>
      <TabsContent value="analytics" className="mt-4">
        <AnalyticsPanel active={tab === "analytics"} />
      </TabsContent>
      <TabsContent value="voices" className="mt-4">
        <VoicesPanel active={tab === "voices"} />
      </TabsContent>
    </Tabs>
  );
}

function ContentPanel() {
  const { data, isLoading, error } = useAdminCurricula();
  const [open, setOpen] = useState<string | null>(null);
  const audio = usePregenerateAudio();

  if (error) return <p className="text-sm text-destructive">{error.message}</p>;
  if (isLoading || !data) return <div className="h-40 animate-pulse rounded-lg bg-muted" />;
  if (open) return <CurriculumPanel id={open} onBack={() => setOpen(null)} />;
  if (data.curricula.length === 0) return <p className="text-sm text-muted-foreground">No PolyLingue course yet: they are written when a learner or a teacher starts one.</p>;

  return (
    <Card>
      <CardContent className="overflow-x-auto p-0">
        <table className="w-full min-w-[48rem] text-sm">
          <thead className="border-b border-border text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Course (shared)</th>
              <th className="px-2 py-2 font-medium">Learners</th>
              <th className="px-2 py-2 font-medium">Lessons ready</th>
              <th className="px-2 py-2 font-medium">With audio</th>
              <th className="px-2 py-2 font-medium">Reports</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {data.curricula.map((c) => (
              <tr key={c.id} className="hover:bg-muted/30">
                <td className="px-3 py-2">
                  <button type="button" className="flex items-center gap-2 text-left" onClick={() => setOpen(c.id)}>
                    <LangBadge code={c.targetLang} size="sm" />
                    <span>
                      <span className="font-medium">
                        {targetLanguage(c.targetLang)?.name} {c.level}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        explanations in {c.baseLang === c.targetLang ? "the same language (immersion)" : c.baseLang.toUpperCase()}
                        {c.classes > 0 ? ` · ${c.classes} class${c.classes > 1 ? "es" : ""}` : ""}
                        {c.status !== "READY" ? ` · ${c.status.toLowerCase()}` : ""}
                      </span>
                    </span>
                  </button>
                </td>
                <td className="px-2 py-2 tabular-nums">{c.learners}</td>
                <td className="px-2 py-2 tabular-nums">
                  {c.ready} / {c.lessons}
                  {c.retired > 0 && <span className="ml-1 text-xs text-muted-foreground">({c.retired} retired)</span>}
                </td>
                <td className="px-2 py-2 tabular-nums">
                  {c.withAudio} / {c.ready}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="ml-1 h-6 w-6"
                    title="Generate the audio of every ready lesson now (local voice)"
                    aria-label="Generate audio"
                    disabled={audio.isPending}
                    onClick={async () => {
                      const r = await audio.mutateAsync(c.id);
                      toast.success(`Audio of ${r.queued} lesson${r.queued === 1 ? "" : "s"} is being generated in the background.`);
                    }}
                  >
                    <AudioLines className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </td>
                <td className="px-2 py-2">
                  {c.openReports > 0 ? (
                    <Badge variant="outline" className="gap-1 border-amber-500/50 text-amber-700">
                      <Flag className="h-3 w-3" aria-hidden="true" /> {c.openReports}
                      {c.hiddenExercises > 0 && ` · ${c.hiddenExercises} hidden`}
                    </Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">–</span>
                  )}
                </td>
                <td className="px-2 py-2 text-right">
                  <Button variant="ghost" size="sm" onClick={() => setOpen(c.id)} aria-label="Open the lessons">
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function CurriculumPanel({ id, onBack }: { id: string; onBack: () => void }) {
  const { data, isLoading, error } = useAdminCurriculum(id);
  if (error) return <p className="text-sm text-destructive">{error.message}</p>;
  if (isLoading || !data) return <div className="h-40 animate-pulse rounded-lg bg-muted" />;
  const c = data.curriculum;
  const units = [...new Set(data.lessons.map((l) => l.unitIndex))];
  return (
    <div className="space-y-3">
      <Button variant="ghost" size="sm" className="gap-1" onClick={onBack}>
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> All courses
      </Button>
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <LangBadge code={c.targetLang} size="sm" /> {targetLanguage(c.targetLang)?.name} {c.level}
      </h2>
      {units.map((u) => (
        <Card key={String(u)}>
          <CardContent className="p-3">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Unit {(u ?? 0) + 1} · {data.lessons.find((l) => l.unitIndex === u)?.unitTitle}
            </p>
            <ul className="divide-y divide-border/60">
              {data.lessons
                .filter((l) => l.unitIndex === u)
                .map((l) => (
                  <li key={l.id}>
                    <Link href={`/admin/polylingue/${l.id}`} className={cn("flex flex-wrap items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-muted/50", l.retiredAt && "opacity-60")}>
                      <span className="min-w-0 flex-1 font-medium">{l.title}</span>
                      {l.status !== "READY" && <Badge variant="secondary">{l.status.toLowerCase()}</Badge>}
                      {l.retiredAt && <Badge variant="outline">retired</Badge>}
                      {l.editedAt && <Badge variant="outline">edited</Badge>}
                      {l.openReports > 0 && (
                        <Badge variant="outline" className="gap-1 border-amber-500/50 text-amber-700">
                          <Flag className="h-3 w-3" aria-hidden="true" /> {l.openReports}
                        </Badge>
                      )}
                      {l.hiddenExercises.length > 0 && (
                        <Badge variant="outline" className="gap-1 border-red-500/50 text-red-600">
                          <EyeOff className="h-3 w-3" aria-hidden="true" /> {l.hiddenExercises.length} hidden
                        </Badge>
                      )}
                      {l.audioAt && <Volume2 className="h-3.5 w-3.5 text-muted-foreground" aria-label="Audio ready" />}
                      <Pencil className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
            </ul>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ReportsPanel() {
  const { data, isLoading, error } = useReportQueue();
  const dismiss = useDismissReports();
  if (error) return <p className="text-sm text-destructive">{error.message}</p>;
  if (isLoading || !data) return <div className="h-40 animate-pulse rounded-lg bg-muted" />;
  if (data.reports.length === 0) return <p className="text-sm text-muted-foreground">No open report. Learners report problems from the feedback after each answer.</p>;
  return (
    <ul className="space-y-2">
      {data.reports.map((r) => (
        <li key={`${r.lessonId}:${r.index}`}>
          <Card>
            <CardContent className="flex flex-wrap items-start gap-3 p-3">
              <LangBadge code={r.curriculum.targetLang} size="sm" />
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-medium">
                  {r.title} · exercise {r.index + 1}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">{r.curriculum.level}</span>
                </p>
                <p className="text-muted-foreground">
                  {r.prompt} → <span className="text-foreground">{r.answer}</span>
                </p>
                <p className="mt-1 flex flex-wrap gap-1">
                  {Object.entries(r.reasons).map(([reason, n]) => (
                    <Badge key={reason} variant="secondary" className="text-[10px]">
                      {REASON[reason] ?? reason} × {n}
                    </Badge>
                  ))}
                  {r.hidden && (
                    <Badge variant="outline" className="gap-1 border-red-500/50 text-[10px] text-red-600">
                      <EyeOff className="h-3 w-3" aria-hidden="true" /> hidden from learners
                    </Badge>
                  )}
                </p>
                {r.comments.length > 0 && <p className="mt-1 text-xs italic text-muted-foreground">“{r.comments.slice(0, 3).join("” · “")}”</p>}
              </div>
              <div className="flex gap-1">
                <Button asChild size="sm" className="h-8">
                  <Link href={`/admin/polylingue/${r.lessonId}?exercise=${r.index}`}>Review</Link>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8"
                  title="Close the reports without changing the exercise (it is shown again)"
                  onClick={() => dismiss.mutate({ lessonId: r.lessonId, index: r.index })}
                >
                  Dismiss
                </Button>
              </div>
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}

function AnalyticsPanel({ active }: { active: boolean }) {
  const { data, isLoading, error } = usePolyAnalytics(active);
  if (error) return <p className="text-sm text-destructive">{error.message}</p>;
  if (isLoading || !data) return <div className="h-40 animate-pulse rounded-lg bg-muted" />;
  const max = Math.max(1, ...data.dailyActive.map((d) => d.learners));
  const rate = (v: number | null) => (v == null ? "–" : `${v}%`);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Tile label="Learners" value={String(data.learners.total)} sub={`${data.learners.humans} people · ${data.learners.courses} courses`} />
        <Tile label="Active (7 days)" value={String(data.learners.active7)} sub={`${data.learners.active30} in 30 days`} />
        <Tile label="Lessons completed" value={String(data.lessons.completed)} sub={`${rate(data.lessons.completionRate)} of those started`} />
        <Tile
          label="Time per lesson"
          value={data.lessons.averageMinutes == null ? "–" : `${data.lessons.averageMinutes} min`}
          sub={`average score ${rate(data.lessons.averageScore)}`}
        />
      </div>

      <Card>
        <CardContent className="space-y-3 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <BarChart3 className="h-4 w-4 text-primary" aria-hidden="true" /> Retention
          </h3>
          <div className="grid grid-cols-3 gap-2">
            {(["day1", "day7", "day30"] as const).map((k) => (
              <div key={k} className="rounded-lg border border-border p-3">
                <p className="text-lg font-semibold tabular-nums">{rate(data.retention[k].rate)}</p>
                <p className="text-xs text-muted-foreground">
                  came back on day {k.slice(3)} · {data.retention[k].retained} of {data.retention[k].eligible}
                </p>
              </div>
            ))}
          </div>
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Learners active per day (last 30 days)</p>
            <div className="flex h-20 items-end gap-0.5" role="img" aria-label="Daily active learners">
              {data.dailyActive.map((d) => (
                <div key={d.day} title={`${d.day}: ${d.learners}`} className="flex-1 rounded-t bg-primary/70" style={{ height: `${Math.max(2, (d.learners / max) * 100)}%` }} />
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle className="h-4 w-4 text-amber-500" aria-hidden="true" /> Hardest exercises (5 answers or more)
          </h3>
          {data.hardest.length === 0 ? (
            <p className="text-sm text-muted-foreground">Not enough answers yet.</p>
          ) : (
            <ul className="divide-y divide-border/60 text-sm">
              {data.hardest.map((h) => (
                <li key={`${h.lessonId}:${h.index}`} className="flex flex-wrap items-center gap-2 py-1.5">
                  <LangBadge code={h.targetLang} size="sm" />
                  <span className="min-w-0 flex-1">
                    {h.prompt} <span className="text-muted-foreground">→ {h.answer}</span>
                    <span className="block text-xs text-muted-foreground">
                      {h.lesson} · {h.level} · {h.type}
                    </span>
                  </span>
                  <Badge variant="outline" className="tabular-nums">
                    {h.wrongRate}% wrong · {h.answers}
                  </Badge>
                  <Button asChild size="sm" variant="ghost" className="h-7">
                    <Link href={`/admin/polylingue/${h.lessonId}?exercise=${h.index}`}>Review</Link>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Course</th>
                <th className="px-2 py-2 font-medium">Learners</th>
                <th className="px-2 py-2 font-medium">Lessons completed</th>
                <th className="px-2 py-2 font-medium">Average score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {data.curricula.map((c) => (
                <tr key={c.id}>
                  <td className="px-3 py-2">
                    {targetLanguage(c.targetLang)?.name} {c.level} <span className="text-xs text-muted-foreground">({c.baseLang})</span>
                  </td>
                  <td className="px-2 py-2 tabular-nums">{c.learners}</td>
                  <td className="px-2 py-2 tabular-nums">{c.lessonsCompleted}</td>
                  <td className="px-2 py-2 tabular-nums">{rate(c.averageScore)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function VoicesPanel({ active }: { active: boolean }) {
  const { data, isLoading, error } = useVoices(active);
  const save = useSaveVoices();
  if (error) return <p className="text-sm text-destructive">{error.message}</p>;
  if (isLoading || !data) return <div className="h-40 animate-pulse rounded-lg bg-muted" />;
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <p className="text-sm text-muted-foreground">
          The voice of each language in PolyLingue. A local voice (Kokoro or Piper, free) is also used to generate each lesson&apos;s audio as soon as the lesson is
          written, so learners never wait. Without a choice, the read-aloud model of AI model is used and audio is made on first play.
        </p>
        <ul className="divide-y divide-border/60">
          {data.languages.map((l) => (
            <li key={l.code} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <LangBadge code={l.code} size="sm" />
              <span className="w-24 font-medium">{l.name}</span>
              <select
                aria-label={`Voice for ${l.name}`}
                className="h-9 min-w-56 rounded-md border border-input bg-background px-2 text-sm"
                value={l.chosen ?? ""}
                disabled={save.isPending}
                onChange={async (e) => {
                  try {
                    await save.mutateAsync({ [l.code]: e.target.value || null });
                    toast.success(`${l.name}: voice saved. Use the audio button of a course to generate its lessons' audio.`);
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Could not save");
                  }
                }}
              >
                <option value="">Read-aloud model (default)</option>
                {l.options.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </select>
              <span className="text-xs text-muted-foreground">Now: {l.current ?? "no voice"}</span>
              {l.chosen && (
                <audio
                  controls
                  preload="none"
                  className="h-8"
                  src={`/api/polylingue/speech?lang=${l.code}&text=${encodeURIComponent(SAMPLE[l.code] ?? "Hello")}`}
                  aria-label={`Sample of the ${l.name} voice`}
                />
              )}
            </li>
          ))}
        </ul>
        {save.isPending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />}
      </CardContent>
    </Card>
  );
}

const SAMPLE: Record<string, string> = {
  es: "Hola, ¿cómo estás? Hoy aprendemos los saludos.",
  en: "Hello, how are you? Today we learn greetings.",
  fr: "Bonjour, comment ça va ? Aujourd'hui, on apprend les salutations.",
  de: "Hallo, wie geht es dir? Heute lernen wir die Begrüßungen.",
  it: "Ciao, come stai? Oggi impariamo i saluti.",
  pt: "Olá, como estás? Hoje aprendemos os cumprimentos.",
};

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-lg font-semibold tabular-nums">{value}</div>
        <p className="text-xs text-muted-foreground">{label}</p>
        {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}
