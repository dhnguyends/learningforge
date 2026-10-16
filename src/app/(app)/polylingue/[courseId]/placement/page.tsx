"use client";

import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { PlacementTest } from "@/components/polylingue/placement-test";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { targetLanguage, type Cefr } from "@/lib/polylingue/levels";
import { usePolyCourse, useUpdateCourse } from "@/hooks/use-polylingue";

/** Placement test for a language already studied: suggests a level; switching only happens if the learner confirms. */
export default function CoursePlacementPage() {
  const { courseId } = useParams<{ courseId: string }>();
  const router = useRouter();
  const confirm = useConfirm();
  const { data: course } = usePolyCourse(courseId);
  const update = useUpdateCourse(courseId);

  async function use(level: Cefr) {
    if (!course) return;
    if (level === course.level) {
      toast.success(`The test confirms your level: ${level}`);
      router.push(`/polylingue/${courseId}`);
      return;
    }
    const ok = await confirm({
      title: `Switch to ${level}?`,
      description: `You study ${course.level} now. Switching opens the ${level} course; your words, XP and streak are kept.`,
      confirmLabel: `Switch to ${level}`,
    });
    if (!ok) return;
    await update.mutateAsync({ level });
    router.push(`/polylingue/${courseId}`);
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-6 sm:px-6">
      <h1 className="text-xl font-semibold tracking-tight">Placement test{course ? ` · ${targetLanguage(course.targetLang)?.name}` : ""}</h1>
      <Card>
        <CardContent className="p-5">
          {course ? (
            <PlacementTest target={course.targetLang} base={course.baseLang} onUse={(l) => void use(l)} onCancel={() => router.push(`/polylingue/${courseId}`)} />
          ) : (
            <div className="h-32 animate-pulse rounded-lg bg-muted" />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
