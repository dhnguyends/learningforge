import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  BookOpen,
  Brain,
  FileVideo,
  Fingerprint,
  GraduationCap,
  Layers,
  LineChart,
  Lock,
  Play,
  Quote,
  ShieldCheck,
  Sparkles,
  Timer,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LogoWordmark } from "@/components/shared/brand";
import { ThemeToggle } from "@/components/shared/theme-toggle";

const FEATURES = [
  {
    icon: FileVideo,
    title: "Lecture video → structured guide",
    body: "Drop in a lecture recording, conference talk, or YouTube link. LectureForge transcribes it, segments the content, and writes a clean study guide with equations, code, and definitions preserved.",
  },
  {
    icon: Quote,
    title: "Every claim cites its source",
    body: "Each statement in a guide, flashcard, or quiz answer links to the exact timestamp or page it came from. Click a citation to hear or read the original moment yourself — verify, don't trust.",
  },
  {
    icon: Layers,
    title: "Eight kinds of quiz questions",
    body: "Multiple choice, multi-select, short answer, ordering, matching, derivation steps, code tracing, and numerical questions with tolerance — with distractor rationale so wrong answers teach too.",
  },
  {
    icon: GraduationCap,
    title: "Advanced STEM exercises",
    body: "Derivations, quantitative problems with dimensional-consistency checks, code debugging, and conceptual transfer — each with prerequisites, assumptions, and progressive hints.",
  },
  {
    icon: Timer,
    title: "Spaced repetition that adapts",
    body: "Flashcards scheduled with FSRS — the modern successor to SM-2 — target ~90% retention. Grade Again / Hard / Good / Easy; intervals learn from your lapses.",
  },
  {
    icon: Brain,
    title: "A tutor that won't hallucinate",
    body: "Ask questions about your own material. The tutor answers from your sources with citations, gives hints before solutions, and says plainly when something isn't in your uploads.",
  },
];

const STEPS = [
  {
    step: "01",
    title: "Upload your material",
    body: "Video, audio, PDFs, slide decks, handwritten notes, images, or a YouTube link. Confirm you have the rights — then processing is private to your workspace.",
  },
  {
    step: "02",
    title: "Watch it get forged",
    body: "Transcription, segmentation, indexing, outline, drafting, validation — each stage visible in real time, with a validation pass that checks citations before anything reaches you.",
  },
  {
    step: "03",
    title: "Study actively",
    body: "Edit anything. Regenerate one section without touching the rest. Review cards, take quizzes, work exercises, talk to the tutor — and track mastery as it compounds.",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" aria-label="LectureForge home">
            <LogoWordmark />
          </Link>
          <nav className="flex items-center gap-2 sm:gap-4">
            <a href="#how-it-works" className="hidden text-sm text-muted-foreground transition-colors hover:text-foreground sm:block">
              How it works
            </a>
            <a href="#features" className="hidden text-sm text-muted-foreground transition-colors hover:text-foreground sm:block">
              Features
            </a>
            <a href="#principles" className="hidden text-sm text-muted-foreground transition-colors hover:text-foreground sm:block">
              Principles
            </a>
            <ThemeToggle />
            <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
              <Link href="/auth/sign-in">Sign in</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/auth/sign-in">
                Create a study set <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </Button>
          </nav>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,hsl(var(--primary)/0.12),transparent)]" />
          <div className="mx-auto max-w-6xl px-4 pb-16 pt-20 sm:px-6 sm:pt-28">
            <div className="mx-auto max-w-3xl text-center">
              <Badge variant="secondary" className="mb-6 gap-1.5">
                <Sparkles className="h-3 w-3" aria-hidden="true" />
                Source-grounded AI for serious students
              </Badge>
              <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl md:text-6xl">
                Turn raw lectures into study material you can{" "}
                <span className="text-primary">actually trust</span>.
              </h1>
              <p className="mx-auto mt-6 max-w-2xl text-pretty text-lg text-muted-foreground">
                LectureForge converts your own course recordings, papers, and notes into editable study guides,
                citation-linked flashcards, adaptive quizzes, and advanced STEM exercises — every claim traceable to the
                exact moment it came from.
              </p>
              <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Button asChild size="lg" className="w-full sm:w-auto">
                  <Link href="/auth/sign-up">
                    Create a study set <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline" className="w-full sm:w-auto">
                  <Link href="/auth/sign-in">Sign in</Link>
                </Button>
              </div>
              <p className="mt-4 text-xs text-muted-foreground">
                Runs fully offline in mock mode — or bring your own AI provider keys.
              </p>
            </div>

            {/* Grounding demo strip */}
            <div className="mx-auto mt-16 max-w-3xl">
              <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <BadgeCheck className="h-3.5 w-3.5 text-[hsl(var(--success))]" aria-hidden="true" />
                  <span className="font-medium text-[hsl(var(--success))]">Supported by source</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono text-[hsl(var(--citation))]">12:41–13:18</span>
                  <span>Lecture 7 — Backpropagation</span>
                </div>
                <p className="mt-3 font-serif text-base leading-relaxed sm:text-lg">
                  “The gradient of the loss with respect to earlier weights is the product of Jacobians along the
                  computational graph —&nbsp;
                  <span className="underline decoration-[hsl(var(--citation)/0.5)] decoration-2 underline-offset-4">
                    which is why the chain rule, not the formula itself, is what you must internalize
                  </span>
                  .”
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border/70 pt-3">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-citation/15 px-2.5 py-0.5 font-mono text-xs text-[hsl(var(--citation))] ring-1 ring-inset ring-[hsl(var(--citation)/0.45)]">
                    <Play className="h-3 w-3" aria-hidden="true" />
                    12:41
                  </span>
                  <span className="text-xs text-muted-foreground">Click any citation to jump to the source moment</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="border-t border-border/60 bg-muted/30 py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <h2 className="text-center text-3xl font-semibold tracking-tight">From recording to recall, in three steps</h2>
            <div className="mt-12 grid gap-8 md:grid-cols-3">
              {STEPS.map((s) => (
                <div key={s.step} className="relative rounded-xl border border-border bg-card p-6">
                  <span className="font-mono text-sm text-primary" aria-hidden="true">
                    {s.step}
                  </span>
                  <h3 className="mt-2 text-lg font-medium">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-semibold tracking-tight">Built for advanced coursework</h2>
              <p className="mt-3 text-muted-foreground">
                Physics, math, CS, engineering — where equations, units, and code have to survive the round trip.
              </p>
            </div>
            <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f) => (
                <div key={f.title} className="group rounded-xl border border-border bg-card p-6 transition-colors hover:border-primary/40">
                  <div className="inline-flex rounded-lg bg-primary/10 p-2.5 text-primary">
                    <f.icon className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <h3 className="mt-4 font-medium">{f.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Principles: honesty, privacy, integrity */}
        <section id="principles" className="border-t border-border/60 bg-muted/30 py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-semibold tracking-tight">Grounded, private, honest</h2>
              <p className="mt-3 text-muted-foreground">
                Three commitments that shape how every feature is built.
              </p>
            </div>
            <div className="mt-12 grid gap-6 md:grid-cols-3">
              <div className="rounded-xl border border-border bg-card p-6">
                <Fingerprint className="h-5 w-5 text-primary" aria-hidden="true" />
                <h3 className="mt-4 font-medium">Never invented, always labeled</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  Every generated claim carries a provenance label — <em>supported by source</em>, <em>inference</em>, or{" "}
                  <em>additional practice</em> — and a validation pass strips uncited claims before you ever see them. If
                  it&apos;s not in your sources, the tutor says so.
                </p>
              </div>
              <div className="rounded-xl border border-border bg-card p-6">
                <Lock className="h-5 w-5 text-primary" aria-hidden="true" />
                <h3 className="mt-4 font-medium">Your material stays yours</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  Study sets are private to your workspace by default. Delete anything, permanently, at any time. Export
                  everything you made. Your content is processed for your study only — never used to train models unless
                  you separately opt in, and never redistributed.
                </p>
              </div>
              <div className="rounded-xl border border-border bg-card p-6">
                <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
                <h3 className="mt-4 font-medium">Learning over answers</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  The tutor leads with Socratic questions and graded hints. Full solutions appear only when you explicitly
                  ask. Exercise feedback explains which criteria you met — and what to try next — instead of just scoring
                  you.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-20">
          <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
            <BookOpen className="mx-auto h-6 w-6 text-primary" aria-hidden="true" />
            <h2 className="mt-4 text-3xl font-semibold tracking-tight">Stop rewatching. Start retaining.</h2>
            <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
              Upload one lecture and have a study guide, a deck, and a quiz before your coffee cools.
            </p>
            <Button asChild size="lg" className="mt-8">
              <Link href="/auth/sign-up">
                Create a study set <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
            <div className="mt-10 flex items-center justify-center gap-6 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <LineChart className="h-3.5 w-3.5" aria-hidden="true" /> FSRS spaced repetition
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Play className="h-3.5 w-3.5" aria-hidden="true" /> Timestamp-accurate citations
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Lock className="h-3.5 w-3.5" aria-hidden="true" /> Private by default
              </span>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/60 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 sm:flex-row sm:px-6">
          <LogoWordmark className="opacity-80" />
          <p className="text-xs text-muted-foreground">
            Process your own course materials, for your own study. Nothing here is affiliated with any university.
          </p>
        </div>
      </footer>
    </div>
  );
}
