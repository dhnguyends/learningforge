"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  Bot,
  CheckCircle2,
  Dumbbell,
  FileStack,
  FileText,
  HelpCircle,
  ImageIcon,
  Layers,
  Loader2,
  Mic,
  Plus,
  Settings2,
  Timer,
  TriangleAlert,
  Youtube,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/misc";
import { useStudySet } from "@/hooks/use-api";

const TABS = [
  { slug: "", label: "Overview", icon: Layers },
  { slug: "sources", label: "Sources", icon: FileStack },
  { slug: "transcript", label: "Transcript", icon: FileText },
  { slug: "guide", label: "Study Guide", icon: BookOpen },
  { slug: "flashcards", label: "Flashcards", icon: Timer },
  { slug: "quiz", label: "Quiz", icon: HelpCircle },
  { slug: "exercises", label: "Exercises", icon: Dumbbell },
  { slug: "tutor", label: "Tutor", icon: Bot },
  { slug: "analytics", label: "Analytics", icon: Settings2 },
];

function SourceIcon({ type }: { type: string }) {
  switch (type) {
    case "VIDEO":
      return <FileStack className="h-3.5 w-3.5" aria-hidden="true" />;
    case "AUDIO":
      return <Mic className="h-3.5 w-3.5" aria-hidden="true" />;
    case "YOUTUBE":
      return <Youtube className="h-3.5 w-3.5" aria-hidden="true" />;
    case "IMAGE":
      return <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />;
    default:
      return <FileText className="h-3.5 w-3.5" aria-hidden="true" />;
  }
}

function SourceStatus({ status }: { status: string }) {
  if (status === "READY") return <CheckCircle2 className="h-3 w-3 shrink-0 text-[hsl(var(--success))]" aria-label="Ready" />;
  if (status === "FAILED") return <TriangleAlert className="h-3 w-3 shrink-0 text-destructive" aria-label="Failed" />;
  return <Loader2 className="h-3 w-3 shrink-0 animate-spin text-primary" aria-label="Processing" />;
}

export default function StudySetLayout({ children, params }: { children: React.ReactNode; params: { studySetId: string } }) {
  const pathname = usePathname();
  const { data, isLoading } = useStudySet(params.studySetId);
  const base = `/study-sets/${params.studySetId}`;
  const set = data?.studySet;

  const activeSlug = (() => {
    const rest = pathname.startsWith(base) ? pathname.slice(base.length).replace(/^\//, "") : "";
    return rest;
  })();

  return (
    <div className="mx-auto flex max-w-[1600px] gap-0 px-0 sm:px-6">
      {/* Left rail: sources + TOC */}
      <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-64 shrink-0 flex-col overflow-y-auto border-r border-border/60 py-6 pr-4 lg:flex">
        <div className="px-3">
          {isLoading || !set ? (
            <div className="space-y-2">
              <Skeleton className="h-5 w-4/5" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : (
            <>
              <Link href={base} className="font-semibold leading-snug hover:text-primary">
                {set.title}
              </Link>
              <p className="mt-1 text-xs text-muted-foreground">{[set.course, set.subject].filter(Boolean).join(" · ") || "No course"}</p>
              {set.dueCards > 0 && (
                <Badge variant="citation" className="mt-2">{set.dueCards} cards due</Badge>
              )}
            </>
          )}
        </div>

        <nav aria-label="Study set tools" className="mt-6 px-3">
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Tools</p>
          <ul className="space-y-0.5">
            {TABS.map((t) => {
              const active = activeSlug === t.slug;
              return (
                <li key={t.slug || "overview"}>
                  <Link
                    href={t.slug ? `${base}/${t.slug}` : base}
                    aria-current={active ? "page" : undefined}
                    className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
                      active ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    <t.icon className="h-3.5 w-3.5" aria-hidden="true" />
                    {t.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="mt-6 flex-1 px-3">
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Sources</p>
            <Link href={`/create?studySetId=${params.studySetId}`} className="flex items-center gap-0.5 text-[11px] text-primary hover:underline">
              <Plus className="h-3 w-3" aria-hidden="true" /> Add
            </Link>
          </div>
          {isLoading ? (
            <div className="space-y-2 pt-1">
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
            </div>
          ) : (
            <ul className="space-y-0.5">
              {(data?.sources ?? []).map((s) => (
                <li key={s.id}>
                  <Link
                    href={`${base}/sources?source=${s.id}`}
                    className="flex items-start gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <SourceStatus status={s.status} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{s.title}</span>
                    </span>
                    <SourceIcon type={s.type} />
                  </Link>
                </li>
              ))}
              {(data?.sources ?? []).length === 0 && <li className="px-2 py-1.5 text-xs text-muted-foreground">No sources yet</li>}
            </ul>
          )}
        </div>
      </aside>

      {/* Center column */}
      <div className="min-w-0 flex-1">
        {/* Mobile tab bar */}
        <nav aria-label="Study set tools" className="scroll-thin sticky top-14 z-30 flex gap-1 overflow-x-auto border-b border-border/60 bg-background/90 px-4 py-2 backdrop-blur lg:hidden">
          {TABS.map((t) => {
            const active = activeSlug === t.slug;
            return (
              <Link
                key={t.slug || "overview"}
                href={t.slug ? `${base}/${t.slug}` : base}
                aria-current={active ? "page" : undefined}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                }`}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>

        <div className="px-4 py-6 sm:px-0 sm:py-8">{children}</div>
      </div>
    </div>
  );
}
