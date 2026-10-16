"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { BASE_LANGUAGES, CEFR_LEVELS, DAILY_GOALS, LEVELS, TARGET_LANGUAGES, isImmersion, type Cefr } from "@/lib/polylingue/levels";
import { useStartCourse } from "@/hooks/use-polylingue";
import { LangBadge } from "@/components/polylingue/lang-badge";
import { PlacementTest } from "@/components/polylingue/placement-test";

const STEPS = ["Level", "Language", "Explanations", "Daily goal"] as const;

/**
 * Start a language: the learner chooses their level first (A1–C2), then the
 * language to learn, the language for explanations, and a daily goal.
 */
export function Onboarding({ taken = [], onCancel }: { taken?: string[]; onCancel?: () => void }) {
  const router = useRouter();
  const start = useStartCourse();
  const [step, setStep] = useState(0);
  const [level, setLevel] = useState<Cefr | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [base, setBase] = useState<string>(() => (typeof navigator !== "undefined" && navigator.language.startsWith("fr") ? "fr" : "en"));
  const [goal, setGoal] = useState<number>(10);
  const [placing, setPlacing] = useState(false);

  // From B2 the course is taught in the language learned: no explanation language to choose.
  const immersion = level ? isImmersion(level) : false;
  const canNext = [Boolean(level), Boolean(target), Boolean(base) && (immersion || base !== target), Boolean(goal)][step];
  const forward = () => setStep((s) => (s === 1 && immersion ? 3 : s + 1));
  const backward = () => setStep((s) => (s === 3 && immersion ? 1 : s - 1));

  async function finish() {
    if (!level || !target) return;
    try {
      const { course } = await start.mutateAsync({
        level,
        targetLang: target,
        baseLang: base,
        dailyGoalMinutes: goal,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      });
      router.push(`/polylingue/${course.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start the course");
    }
  }

  return (
    <Card>
      <CardContent className="space-y-5 p-5">
        <ol className="flex items-center gap-2 text-xs" aria-label="Steps">
          {STEPS.map((s, i) => (
            <li
              key={s}
              className={cn("flex items-center gap-1.5", i === step ? "font-semibold text-foreground" : "text-muted-foreground", immersion && i === 2 && "line-through opacity-50")}
              title={immersion && i === 2 ? "Not needed: B2 and above are taught in the language you learn" : undefined}
            >
              <span className={cn("flex h-5 w-5 items-center justify-center rounded-full text-[10px]", i < step ? "bg-primary text-primary-foreground" : i === step ? "bg-primary/15 text-primary" : "bg-muted")}>
                {i < step ? <Check className="h-3 w-3" aria-hidden="true" /> : i + 1}
              </span>
              <span className="hidden sm:inline">{s}</span>
            </li>
          ))}
        </ol>

        {step === 0 && placing && (
          <div className="space-y-2">
            <h2 className="text-base font-semibold">Placement test</h2>
            <PlacementTest
              onCancel={() => setPlacing(false)}
              onUse={(l, t, b) => {
                // The learner accepted the suggestion: level, language and explanations are set.
                setLevel(l);
                setTarget(t);
                setBase(b);
                setPlacing(false);
                setStep(3);
              }}
            />
          </div>
        )}

        {step === 0 && !placing && (
          <fieldset className="space-y-2">
            <legend className="mb-2 text-base font-semibold">What is your level?</legend>
            <p className="-mt-1 mb-3 text-sm text-muted-foreground">
              Your course, its words, grammar and exercises are written for this level. You can change it later.{" "}
              <button type="button" className="font-medium text-primary hover:underline" onClick={() => setPlacing(true)}>
                Not sure? Take the 5-minute placement test.
              </button>
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {CEFR_LEVELS.map((l) => (
                <OptionTile key={l} selected={level === l} onClick={() => setLevel(l)}>
                  <span className="flex items-center gap-2">
                    <span className="rounded-md bg-primary/10 px-1.5 py-0.5 font-mono text-sm font-bold text-primary">{l}</span>
                    <span className="font-medium">{LEVELS[l].name}</span>
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">{LEVELS[l].canDo}</span>
                  {LEVELS[l].immersion && (
                    <span className="mt-1.5 block text-[11px] font-medium text-primary">Taught entirely in the language you learn</span>
                  )}
                </OptionTile>
              ))}
            </div>
          </fieldset>
        )}

        {step === 1 && (
          <fieldset className="space-y-2">
            <legend className="mb-3 text-base font-semibold">Which language do you want to learn?</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {TARGET_LANGUAGES.map((l) => (
                <OptionTile key={l.code} selected={target === l.code} onClick={() => setTarget(l.code)}>
                  <LangBadge code={l.code} />
                  <span className="mt-1 block font-medium">{l.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {l.native}
                    {taken.includes(l.code) ? " · you follow it (choosing it changes its level)" : ""}
                  </span>
                </OptionTile>
              ))}
            </div>
          </fieldset>
        )}

        {step === 2 && (
          <fieldset className="space-y-2">
            <legend className="mb-3 text-base font-semibold">In which language should we explain?</legend>
            <p className="-mt-1 mb-3 text-sm text-muted-foreground">Instructions, translations, hints and grammar tips.</p>
            <div className="grid grid-cols-2 gap-2">
              {BASE_LANGUAGES.map((l) => (
                <OptionTile key={l.code} selected={base === l.code} onClick={() => setBase(l.code)} disabled={l.code === target}>
                  <span className="font-medium">{l.name}</span>
                  {l.code === target && <span className="block text-xs text-muted-foreground">This is the language you learn</span>}
                </OptionTile>
              ))}
            </div>
          </fieldset>
        )}

        {step === 3 && (
          <fieldset className="space-y-2">
            <legend className="mb-3 text-base font-semibold">Your daily goal</legend>
            <p className="-mt-1 mb-3 text-sm text-muted-foreground">A short, regular habit works best: 10 to 15 minutes a day.</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {DAILY_GOALS.map((g) => (
                <OptionTile key={g} selected={goal === g} onClick={() => setGoal(g)}>
                  <span className="text-lg font-semibold">{g} min</span>
                  <span className="block text-xs text-muted-foreground">{g === 5 ? "Casual" : g === 10 ? "Regular" : g === 15 ? "Serious" : "Intense"}</span>
                </OptionTile>
              ))}
            </div>
          </fieldset>
        )}

        <div className="flex items-center justify-between gap-2">
          <div>
            {step > 0 ? (
              <Button variant="ghost" onClick={backward} className="gap-1.5">
                <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back
              </Button>
            ) : (
              onCancel && (
                <Button variant="ghost" onClick={onCancel}>
                  Cancel
                </Button>
              )
            )}
          </div>
          {step < STEPS.length - 1 ? (
            <Button onClick={forward} disabled={!canNext} className="gap-1.5">
              Next <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          ) : (
            <Button onClick={() => void finish()} disabled={!canNext || start.isPending} className="gap-1.5">
              {start.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Start learning
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function OptionTile({
  selected,
  onClick,
  disabled,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        "rounded-lg border p-3 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        selected ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:bg-muted/50",
      )}
    >
      {children}
    </button>
  );
}
