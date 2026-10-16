"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Snail, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { speechSrc } from "@/hooks/use-polylingue";

let current: HTMLAudioElement | null = null;

/** Plays a target-language text (normal or slow); one clip at a time across the page. */
export function useSpeak(lang: string) {
  const [loading, setLoading] = useState(false);
  const speak = useCallback(
    async (text: string, slow = false) => {
      if (!text) return;
      current?.pause();
      const audio = new Audio(speechSrc(lang, text));
      audio.playbackRate = slow ? 0.75 : 1;
      (audio as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true;
      current = audio;
      setLoading(true);
      try {
        await audio.play();
      } catch {
        toast.error("Audio unavailable: check the text-to-speech settings in Admin → AI model.");
      } finally {
        setLoading(false);
      }
    },
    [lang],
  );
  useEffect(() => () => current?.pause(), []);
  return { speak, loading };
}

/** Play and slow-play buttons for one text. */
export function SpeakButtons({
  lang,
  text,
  autoPlay = false,
  autoPlaySlow = false,
  size = "md",
  className,
}: {
  lang: string;
  text: string;
  autoPlay?: boolean;
  /** Auto-play at slow speed (support mode). */
  autoPlaySlow?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const { speak, loading } = useSpeak(lang);
  const played = useRef<string | null>(null);
  useEffect(() => {
    if (autoPlay && text && played.current !== text) {
      played.current = text;
      void speak(text, autoPlaySlow);
    }
  }, [autoPlay, autoPlaySlow, text, speak]);
  if (!text) return null;
  const box = size === "lg" ? "h-12 w-12" : size === "sm" ? "h-7 w-7" : "h-9 w-9";
  const icon = size === "lg" ? "h-6 w-6" : size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <button
        type="button"
        onClick={() => void speak(text)}
        className={cn("inline-flex items-center justify-center rounded-full bg-primary/10 text-primary transition-colors hover:bg-primary/20", box)}
        aria-label="Listen"
        title="Listen"
      >
        {loading ? <Loader2 className={cn(icon, "animate-spin")} aria-hidden="true" /> : <Volume2 className={icon} aria-hidden="true" />}
      </button>
      <button
        type="button"
        onClick={() => void speak(text, true)}
        className={cn("inline-flex items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted", box)}
        aria-label="Listen slowly"
        title="Listen slowly"
      >
        <Snail className={icon} aria-hidden="true" />
      </button>
    </span>
  );
}
