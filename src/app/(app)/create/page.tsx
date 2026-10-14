"use client";

import { Suspense, useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  FileAudio,
  FileText,
  FileVideo,
  Image as ImageIcon,
  Loader2,
  Lock,
  Trash2,
  UploadCloud,
  Youtube,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/misc";
import { JobProgressRow } from "@/components/shared/job-status";
import { api, uploadToTicket, useStudySet } from "@/hooks/use-api";
import { formatBytes } from "@/lib/utils";

/* ---------------------- client-side upload validation ---------------------- */
/* Mirrors src/lib/uploads.ts (server re-validates on every path). */

const ACCEPT = ".mp4,.webm,.mov,.mp3,.wav,.m4a,.pdf,.pptx,.docx,.png,.jpg,.jpeg,.txt,.md";
const RECORDING_RE = /^(video|audio)\//;
const MAX_BYTES: Record<string, number> = { video: 2e9, audio: 5e8, other: 2e8 };

function iconForMime(mime: string) {
  if (mime.startsWith("video/")) return FileVideo;
  if (mime.startsWith("audio/")) return FileAudio;
  if (mime.startsWith("image/")) return ImageIcon;
  return FileText;
}

function validate(file: File): string | null {
  const okMime =
    RECORDING_RE.test(file.type) ||
    ["application/pdf", "image/png", "image/jpeg", "text/plain", "text/markdown"].includes(file.type) ||
    file.name.toLowerCase().endsWith(".pptx") ||
    file.name.toLowerCase().endsWith(".docx");
  if (!okMime) return `${file.name}: unsupported type (${file.type || "unknown"}). Allowed: lecture video/audio, PDF, slides, docs, images, notes.`;
  const cap = RECORDING_RE.test(file.type) ? MAX_BYTES[file.type.split("/")[0]] : MAX_BYTES.other;
  if (file.size > cap) return `${file.name}: exceeds ${formatBytes(cap)} limit.`;
  return null;
}

/* ------------------------------- page state ------------------------------- */

type StagedFile = { id: string; file: File; progress: number; status: "staged" | "uploading" | "done" | "error"; error?: string };
type StagedVideo = { id: string; url: string; title?: string };

const OUTPUT_TYPES: { value: string; label: string; hint: string }[] = [
  { value: "GUIDE", label: "Study guide", hint: "Structured, citation-linked notes" },
  { value: "FLASHCARDS", label: "Flashcards", hint: "FSRS-scheduled spaced repetition" },
  { value: "QUIZ", label: "Quiz", hint: "Adaptive, 8 question types" },
  { value: "EXERCISES", label: "Exercises", hint: "Advanced STEM problem sets" },
  { value: "AUDIO_RECAP", label: "Audio recap", hint: "Listen-only summary (per guide)" },
  { value: "TUTOR", label: "AI tutor", hint: "Grounded chat about your sources" },
];

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "de", label: "German" },
  { value: "fr", label: "French" },
  { value: "es", label: "Spanish" },
  { value: "zh", label: "Chinese" },
  { value: "ja", label: "Japanese" },
];

export default function CreatePage() {
  // useSearchParams needs a Suspense boundary for static prerendering.
  return (
    <Suspense fallback={null}>
      <CreateWizard />
    </Suspense>
  );
}

function CreateWizard() {
  const router = useRouter();
  const params = useSearchParams();
  const existingSetId = params.get("studySetId");

  const [step, setStep] = useState<1 | 2 | 3>(existingSetId ? 2 : 1);
  const [setId, setSetId] = useState<string | null>(existingSetId);

  // step 1 — details
  const [title, setTitle] = useState("");
  const [course, setCourse] = useState("");
  const [subject, setSubject] = useState("");
  const [level, setLevel] = useState("ADVANCED_UNDERGRAD");
  const [examDate, setExamDate] = useState("");
  const [language, setLanguage] = useState("en");
  const [outputs, setOutputs] = useState<string[]>(["GUIDE", "FLASHCARDS", "QUIZ"]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [detailLevel, setDetailLevel] = useState("detailed");
  const [citationStrictness, setCitationStrictness] = useState("standard");
  const [includeExternal, setIncludeExternal] = useState(false);
  const [sourceOnlyMode, setSourceOnlyMode] = useState(false);

  // step 2 — sources
  const [files, setFiles] = useState<StagedFile[]>([]);
  const [videos, setVideos] = useState<StagedVideo[]>([]);
  const [ytUrl, setYtUrl] = useState("");
  const [rights, setRights] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const hasRecordings = useMemo(
    () => files.some((f) => RECORDING_RE.test(f.file.type)) || videos.length > 0,
    [files, videos],
  );

  const onFiles = useCallback((incoming: FileList | File[]) => {
    const next: StagedFile[] = [];
    for (const file of Array.from(incoming)) {
      const err = validate(file);
      if (err) {
        toast.error(err);
        continue;
      }
      next.push({ id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 8)}`, file, progress: 0, status: "staged" });
    }
    if ((files.length + next.length) > 10) {
      toast.error("Up to 10 sources per study set.");
      return;
    }
    if (next.length) setFiles((prev) => [...prev, ...next]);
  }, [files.length]);

  function addYouTube() {
    const url = ytUrl.trim();
    if (!/^(https?:\/\/)?(www\.|m\.)?(youtube\.com\/watch\?v=|youtu\.be\/)[\w-]{6,}/.test(url)) {
      toast.error("That doesn't look like a YouTube video URL");
      return;
    }
    if (videos.some((v) => v.url === url)) {
      toast.error("Already added");
      return;
    }
    setVideos((prev) => [...prev, { id: url, url }]);
    setYtUrl("");
  }

  async function submitSources() {
    if (files.length === 0 && videos.length === 0) {
      toast.error("Add at least one source");
      return;
    }
    setSubmitting(true);
    try {
      let targetSetId = setId;

      if (!targetSetId) {
        // Create the study set with everything in one call (YouTube sources ingest immediately).
        const created = await api<{ studySet: { id: string }; sources: { id: string; kind: "file" | "youtube"; upload?: { uploadUrl: string; headers?: Record<string, string>; key: string } }[] }>(
          "/api/study-sets",
          {
            method: "POST",
            body: JSON.stringify({
              title: title.trim(),
              course: course.trim() || undefined,
              subject: subject.trim() || undefined,
              learnerLevel: level,
              examDate: examDate ? new Date(`${examDate}T23:59:00`).toISOString() : undefined,
              language,
              outputTypes: outputs,
              settings: { detailLevel, citationStrictness, includeExternal, sourceOnlyMode },
              rightsConfirmed: rights || !hasRecordings ? true : false,
              sources: [
                ...files.map((f) => ({ kind: "file" as const, filename: f.file.name, mimeType: f.file.type || "application/octet-stream", sizeBytes: f.file.size })),
                ...videos.map((v) => ({ kind: "youtube" as const, url: v.url, consent: true })),
              ],
            }),
          },
        );
        targetSetId = created.studySet.id;
        setSetId(targetSetId);

        // Upload each staged file to its ticket, in order (response preserves input order).
        const fileSources = created.sources.filter((s) => s.kind === "file");
        for (let i = 0; i < files.length && i < fileSources.length; i++) {
          const staged = files[i];
          const src = fileSources[i];
          if (!src.upload) continue;
          setFiles((prev) => prev.map((f) => (f.id === staged.id ? { ...f, status: "uploading" } : f)));
          try {
            await uploadToTicket(src.upload, staged.file, (p) =>
              setFiles((prev) => prev.map((f) => (f.id === staged.id ? { ...f, progress: p } : f))),
            );
            await api("/api/uploads/complete", { method: "POST", body: JSON.stringify({ sourceId: src.id }) });
            setFiles((prev) => prev.map((f) => (f.id === staged.id ? { ...f, status: "done", progress: 1 } : f)));
          } catch (err) {
            setFiles((prev) => prev.map((f) => (f.id === staged.id ? { ...f, status: "error", error: err instanceof Error ? err.message : "upload failed" } : f)));
          }
        }
      } else {
        // Adding sources to an existing set — one request per source.
        for (const staged of files) {
          setFiles((prev) => prev.map((f) => (f.id === staged.id ? { ...f, status: "uploading" } : f)));
          try {
            const created = await api<{ source: { id: string }; upload: { uploadUrl: string; headers?: Record<string, string>; key: string } }>(
              `/api/study-sets/${targetSetId}/sources`,
              {
                method: "POST",
                body: JSON.stringify({
                  kind: "file",
                  filename: staged.file.name,
                  mimeType: staged.file.type || "application/octet-stream",
                  sizeBytes: staged.file.size,
                  consent: RECORDING_RE.test(staged.file.type) ? true : undefined,
                }),
              },
            );
            await uploadToTicket(created.upload, staged.file, (p) =>
              setFiles((prev) => prev.map((f) => (f.id === staged.id ? { ...f, progress: p } : f))),
            );
            await api("/api/uploads/complete", { method: "POST", body: JSON.stringify({ sourceId: created.source.id }) });
            setFiles((prev) => prev.map((f) => (f.id === staged.id ? { ...f, status: "done", progress: 1 } : f)));
          } catch (err) {
            setFiles((prev) => prev.map((f) => (f.id === staged.id ? { ...f, status: "error", error: err instanceof Error ? err.message : "upload failed" } : f)));
          }
        }
        for (const v of videos) {
          try {
            await api(`/api/study-sets/${targetSetId}/sources`, { method: "POST", body: JSON.stringify({ kind: "youtube", url: v.url, consent: true }) });
          } catch (err) {
            toast.error(err instanceof Error ? err.message : `Could not add ${v.url}`);
          }
        }
      }

      setStep(3);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create study set");
    } finally {
      setSubmitting(false);
    }
  }

  const detailsValid = title.trim().length >= 3;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      {/* Stepper */}
      <ol className="mb-8 flex items-center gap-2 text-sm" aria-label="Progress">
        {["Details", "Sources", "Processing"].map((label, i) => {
          const n = i + 1;
          const state = step === n ? "current" : step > n ? "done" : "todo";
          return (
            <li key={label} className="flex items-center gap-2">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
                  state === "done"
                    ? "bg-[hsl(var(--success))]/20 text-[hsl(var(--success))]"
                    : state === "current"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                }`}
                aria-current={state === "current" ? "step" : undefined}
              >
                {state === "done" ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> : n}
              </span>
              <span className={state === "todo" ? "text-muted-foreground" : "font-medium"}>{label}</span>
              {n < 3 && <span className="mx-1 h-px w-8 bg-border sm:w-14" aria-hidden="true" />}
            </li>
          );
        })}
      </ol>

      {step === 1 && (
        <Card>
          <CardContent className="space-y-5 py-6">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">New study set</h1>
              <p className="mt-1 text-sm text-muted-foreground">Tell the forge what this material is — it shapes every generated output.</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="title">Title *</Label>
              <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Lecture 7 — Backpropagation & Optimization" autoFocus />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="course">Course</Label>
                <Input id="course" value={course} onChange={(e) => setCourse(e.target.value)} placeholder="CS 584 — Deep Learning" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="subject">Subject</Label>
                <Input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Machine learning" />
              </div>
              <div className="space-y-1.5">
                <Label>Level</Label>
                <Select value={level} onValueChange={setLevel}>
                  <SelectTrigger aria-label="Learner level"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="INTRODUCTORY">Introductory</SelectItem>
                    <SelectItem value="ADVANCED_UNDERGRAD">Advanced undergrad</SelectItem>
                    <SelectItem value="GRADUATE">Graduate</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="exam">Exam date (optional)</Label>
                <Input id="exam" type="date" value={examDate} onChange={(e) => setExamDate(e.target.value)} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>What should we generate? *</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {OUTPUT_TYPES.map((o) => {
                  const active = outputs.includes(o.value);
                  return (
                    <button
                      key={o.value}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setOutputs((prev) => (active ? prev.filter((x) => x !== o.value) : [...prev, o.value]))}
                      className={`rounded-lg border p-3 text-left transition-colors ${active ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}
                    >
                      <span className="flex items-center justify-between text-sm font-medium">
                        {o.label}
                        {active && <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden="true" />}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{o.hint}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Advanced */}
            <div className="rounded-lg border border-border">
              <button type="button" onClick={() => setAdvancedOpen((v) => !v)} className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium" aria-expanded={advancedOpen}>
                Advanced settings
                <ChevronDown className={`h-4 w-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`} aria-hidden="true" />
              </button>
              {advancedOpen && (
                <div className="space-y-4 border-t border-border px-4 py-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label>Detail level</Label>
                      <Select value={detailLevel} onValueChange={setDetailLevel}>
                        <SelectTrigger aria-label="Detail level"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="concise">Concise</SelectItem>
                          <SelectItem value="detailed">Detailed</SelectItem>
                          <SelectItem value="comprehensive">Comprehensive</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Citation strictness</Label>
                      <Select value={citationStrictness} onValueChange={setCitationStrictness}>
                        <SelectTrigger aria-label="Citation strictness"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="relaxed">Relaxed</SelectItem>
                          <SelectItem value="standard">Standard</SelectItem>
                          <SelectItem value="strict">Strict — drop uncited claims</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <ToggleRow
                    checked={sourceOnlyMode}
                    onChange={setSourceOnlyMode}
                    label="Source-only mode"
                    hint="Never generate beyond what your sources state — no synthesis or examples."
                  />
                  <ToggleRow
                    checked={includeExternal}
                    onChange={setIncludeExternal}
                    label="Allow external knowledge"
                    hint="Off by default. When off, generation uses only your uploaded material; external practice is clearly labeled when on."
                    warn={includeExternal}
                  />
                </div>
              )}
            </div>

            <div className="flex items-center justify-between">
              <Button variant="ghost" asChild>
                <Link href="/dashboard"><ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden="true" /> Cancel</Link>
              </Button>
              <Button disabled={!detailsValid || outputs.length === 0} onClick={() => setStep(2)}>
                Continue to sources <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardContent className="space-y-5 py-6">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">{setId ? "Add sources" : "Add your sources"}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Lecture recordings, talks, papers, slide decks, notes, images — or a YouTube link. Up to 10 per set.
              </p>
            </div>

            {/* Dropzone */}
            <div
              role="button"
              tabIndex={0}
              aria-label="Upload files: drag and drop or click to browse"
              onClick={() => fileInput.current?.click()}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileInput.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                onFiles(e.dataTransfer.files);
              }}
              className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-10 text-center transition-colors ${
                dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/40"
              }`}
            >
              <UploadCloud className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm font-medium">Drag & drop files, or click to browse</p>
              <p className="text-xs text-muted-foreground">
                MP4/WebM/MOV up to 2 GB · MP3/WAV/M4A up to 500 MB · PDF/PPTX/DOCX/PNG/JPG/TXT up to 200 MB
              </p>
              <input
                ref={fileInput}
                type="file"
                multiple
                accept={ACCEPT}
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) onFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>

            {/* Staged files */}
            {files.length > 0 && (
              <ul className="space-y-2" aria-label="Staged files">
                {files.map((f) => {
                  const Icon = iconForMime(f.file.type);
                  return (
                    <li key={f.id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{f.file.name}</p>
                        {f.status === "uploading" ? (
                          <Progress value={Math.round(f.progress * 100)} className="mt-1 h-1.5" />
                        ) : f.status === "error" ? (
                          <p className="text-xs text-destructive">{f.error}</p>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            {formatBytes(f.file.size)}
                            {f.status === "done" && " · uploaded"}
                          </p>
                        )}
                      </div>
                      {f.status === "done" ? (
                        <CheckCircle2 className="h-4 w-4 text-[hsl(var(--success))]" aria-hidden="true" />
                      ) : f.status === "uploading" ? (
                        <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
                      ) : (
                        <Button variant="ghost" size="icon" aria-label={`Remove ${f.file.name}`} className="h-7 w-7" onClick={() => setFiles((prev) => prev.filter((x) => x.id !== f.id))}>
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            <Separator />

            {/* YouTube */}
            <div className="space-y-2">
              <Label htmlFor="yt">YouTube link</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Youtube className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <Input id="yt" className="pl-9" value={ytUrl} onChange={(e) => setYtUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addYouTube())} />
                </div>
                <Button type="button" variant="outline" onClick={addYouTube}>Add</Button>
              </div>
              {videos.length > 0 && (
                <ul className="space-y-2" aria-label="YouTube sources">
                  {videos.map((v) => (
                    <li key={v.id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
                      <Youtube className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate text-sm">{v.url}</span>
                      <Button variant="ghost" size="icon" aria-label={`Remove ${v.url}`} className="h-7 w-7" onClick={() => setVideos((prev) => prev.filter((x) => x.id !== v.id))}>
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Consent */}
            {hasRecordings && (
              <div className="flex gap-3 rounded-lg border border-[hsl(var(--warning))]/40 bg-[hsl(var(--warning))]/5 p-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--warning))]" aria-hidden="true" />
                <label className="flex cursor-pointer items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={rights}
                    onChange={(e) => setRights(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-border accent-[hsl(var(--primary))]"
                  />
                  <span>
                    I have permission to upload and process these recordings, and I understand they are processed only in my
                    private workspace to build my study material.{" "}
                    <span className="text-muted-foreground">Recordings of other people require their consent.</span>
                  </span>
                </label>
              </div>
            )}

            <div className="flex items-center justify-between">
              {!setId ? (
                <Button variant="ghost" onClick={() => setStep(1)}>
                  <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden="true" /> Back
                </Button>
              ) : (
                <Button variant="ghost" asChild>
                  <Link href={`/study-sets/${setId}`}><ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden="true" /> Back to study set</Link>
                </Button>
              )}
              <Button onClick={() => void submitSources()} disabled={submitting || (files.length === 0 && videos.length === 0) || (hasRecordings && !rights)}>
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> Uploading…
                  </>
                ) : (
                  <>
                    <UploadCloud className="mr-1.5 h-4 w-4" aria-hidden="true" /> Upload & process
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 3 && setId && <ProcessingView studySetId={setId} />}
    </div>
  );
}

function ToggleRow({ checked, onChange, label, hint, warn }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string; warn?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className={`text-xs ${warn ? "text-[hsl(var(--warning))]" : "text-muted-foreground"}`}>{hint}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? "bg-primary" : "bg-muted-foreground/30"}`}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-background shadow transition-all ${checked ? "left-[22px]" : "left-0.5"}`} />
      </button>
    </div>
  );
}

/** Step 3 — live processing dashboard. */
function ProcessingView({ studySetId }: { studySetId: string }) {
  const { data } = useStudySet(studySetId);
  const sources = data?.sources ?? [];
  const jobs = data?.jobs ?? [];
  const active = jobs.filter((j) => j.status === "QUEUED" || j.status === "RUNNING");
  const anyReady = sources.some((s) => s.status === "READY");
  const anyFailed = sources.some((s) => s.status === "FAILED");
  const allSettled = sources.length > 0 && sources.every((s) => s.status === "READY" || s.status === "FAILED");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Forging your study set…</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Transcription, segmentation, and indexing run first; your first outputs generate automatically once sources are ready.
          </p>
        </div>
        {active.length > 0 && <Loader2 className="h-5 w-5 animate-spin text-primary" aria-label="Processing" />}
      </div>

      <Card>
        <CardContent className="divide-y divide-border/70 py-2">
          {sources.map((s) => (
            <div key={s.id} className="flex items-center gap-3 py-3">
              {s.status === "READY" ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-[hsl(var(--success))]" aria-hidden="true" />
              ) : s.status === "FAILED" ? (
                <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
              ) : (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden="true" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{s.title}</p>
                {s.error ? (
                  <p className="text-xs text-destructive">{s.error}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {s.type} · {s.status === "READY" ? "indexed & cited" : s.status === "PENDING_UPLOAD" ? "waiting for upload" : "processing"}
                  </p>
                )}
              </div>
              <Badge variant={s.status === "READY" ? "success" : s.status === "FAILED" ? "destructive" : "secondary"}>{s.status}</Badge>
            </div>
          ))}
          {sources.length === 0 && <p className="py-6 text-sm text-muted-foreground">Waiting for sources…</p>}
        </CardContent>
      </Card>

      {jobs.length > 0 && (
        <Card>
          <CardContent className="py-3">
            <h2 className="mb-1 text-sm font-medium">Jobs</h2>
            {jobs.slice(0, 8).map((j, i) => (
              <JobProgressRow key={j.id ?? i} job={j} />
            ))}
          </CardContent>
        </Card>
      )}

      <div className="flex items-center gap-3">
        <Button asChild variant={allSettled || anyReady ? "default" : "outline"}>
          <Link href={`/study-sets/${studySetId}`}>
            {allSettled || anyReady ? "Open study set" : "Open workspace while it runs"} <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
          </Link>
        </Button>
        {anyFailed && <p className="text-sm text-destructive">A source failed — open the workspace to retry or remove it.</p>}
        <p className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock className="h-3 w-3" aria-hidden="true" /> Private to your workspace
        </p>
      </div>
    </div>
  );
}
