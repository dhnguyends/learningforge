"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { BarChart3, BookOpen, GraduationCap, Headphones, Languages, Mic, PenLine, Plus, Repeat, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import { targetLanguage } from "@/lib/polylingue/levels";
import { LangBadge } from "@/components/polylingue/lang-badge";
import { usePolyCourses } from "@/hooks/use-polylingue";

/**
 * PolyLingue frame: a practice panel on the left (a scrolling bar on phones)
 * with the learner's languages and, for the open language (or the most recent
 * one on the PolyLingue home), its lessons, the four skills, weak words,
 * review and progress.
 */
export default function PolyLingueLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ courseId?: string }>();
  const pathname = usePathname();
  const { data } = usePolyCourses();
  const courses = data?.courses ?? [];
  const course = courses.find((c) => c.id === params.courseId) ?? (params.courseId ? undefined : courses[0]);
  const courseId = params.courseId ?? course?.id;
  const base = courseId ? `/polylingue/${courseId}` : null;

  const items = base
    ? [
        { href: base, label: "Lessons", icon: GraduationCap, active: pathname === base || pathname.startsWith(`${base}/lesson`) },
        { href: `${base}/practice/reading`, label: "Reading", icon: BookOpen },
        { href: `${base}/practice/listening`, label: "Listening", icon: Headphones },
        { href: `${base}/practice/writing`, label: "Writing", icon: PenLine },
        { href: `${base}/practice/speaking`, label: "Speaking", icon: Mic },
        { href: `${base}/weak`, label: "Weak words", icon: Target },
        { href: `${base}/review`, label: course?.dueWords ? `Review (${course.dueWords})` : "Review", icon: Repeat },
        { href: `${base}/progress`, label: "Progress", icon: BarChart3 },
      ].map((i) => ({ ...i, active: "active" in i && i.active !== undefined ? i.active : pathname.startsWith(i.href) }))
    : [];

  const linkClass = (active: boolean) =>
    cn(
      "flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
      active ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
    );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col lg:flex-row lg:gap-2">
      <aside className="border-b border-border/60 lg:sticky lg:top-14 lg:h-[calc(100vh-3.5rem)] lg:w-56 lg:shrink-0 lg:overflow-y-auto lg:border-b-0 lg:border-r lg:py-5">
        <nav aria-label="PolyLingue" className="flex gap-1 overflow-x-auto px-3 py-2 lg:flex-col lg:overflow-visible lg:py-0">
          <Link href="/polylingue" className={linkClass(pathname === "/polylingue")}>
            <Languages className="h-4 w-4" aria-hidden="true" /> My languages
          </Link>
          {courses.map((c) => (
            <Link
              key={c.id}
              href={`/polylingue/${c.id}`}
              className={cn(linkClass(false), c.id === courseId && "font-medium text-foreground", "lg:pl-4")}
              title={`${targetLanguage(c.targetLang)?.name ?? c.targetLang} ${c.level}`}
            >
              <LangBadge code={c.targetLang} size="sm" /> {targetLanguage(c.targetLang)?.name ?? c.targetLang} · {c.level}
            </Link>
          ))}
          <Link href="/polylingue?add=1" className={cn(linkClass(false), "lg:pl-4")}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Add a language
          </Link>

          {items.length > 0 && (
            <>
              <p className="hidden px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground lg:block">
                {course ? `Practise ${targetLanguage(course.targetLang)?.name ?? ""}` : "Practise"}
              </p>
              <span className="mx-1 w-px shrink-0 bg-border lg:hidden" aria-hidden="true" />
              {items.map((i) => (
                <Link key={i.href} href={i.href} aria-current={i.active ? "page" : undefined} className={linkClass(i.active)}>
                  <i.icon className="h-4 w-4" aria-hidden="true" /> {i.label}
                </Link>
              ))}
            </>
          )}
        </nav>
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
