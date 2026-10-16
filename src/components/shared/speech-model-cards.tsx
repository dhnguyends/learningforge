"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, AudioLines, CheckCircle2, Cloud, Cpu, Languages, Loader2, PlugZap, Volume2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  useSaveTranslatorChoice,
  useSaveTtsChoice,
  useSpeechSettings,
  useTestTranslator,
  useTestTts,
  type SpeechSettings,
  type TranslatorChoiceInput,
  type TranslatorTestResult,
  type TtsChoiceInput,
} from "@/hooks/use-api";

const LANGS = [
  { id: "en", label: "English" },
  { id: "fr", label: "French" },
] as const;

const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function Loading() {
  return <div className="h-40 animate-pulse rounded-lg bg-muted" />;
}

function LoadError({ message }: { message?: string }) {
  return (
    <Card>
      <CardContent className="py-8 text-center text-sm text-destructive">{message ?? "Could not load speech settings"}</CardContent>
    </Card>
  );
}

function CloudWarning({ provider, what }: { provider: string; what: string }) {
  return (
    <p className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
      <span>
        With a cloud model, {what} of your uploaded sources is sent to {provider}. On free tiers it may be used to improve
        the provider&apos;s products; use a paid plan for private material.
      </span>
    </p>
  );
}

function OptionRow({
  name,
  value,
  checked,
  disabled,
  cloud,
  label,
  note,
  inUse,
  onSelect,
}: {
  name: string;
  value: string;
  checked: boolean;
  disabled: boolean;
  cloud: string | null;
  label: string;
  note: string;
  inUse: boolean;
  onSelect: () => void;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors",
        checked ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
        className="mt-1 accent-[hsl(var(--primary))]"
      />
      <span className="flex-1">
        <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {cloud ? <Cloud className="h-3.5 w-3.5" aria-hidden="true" /> : <Cpu className="h-3.5 w-3.5" aria-hidden="true" />}
          {label}
          {inUse && <Badge className="text-[10px]">In use</Badge>}
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{note}</span>
      </span>
    </label>
  );
}

/**
 * Translator used to make French sources bilingual (English passages for
 * search, English transcript for the reader). Local Gemma 4 by default.
 */
export function TranslatorCard() {
  const { data, isLoading, error } = useSpeechSettings();
  const save = useSaveTranslatorChoice();
  const test = useTestTranslator();
  const [selected, setSelected] = useState<TranslatorChoiceInput["provider"] | null>(null);
  const [result, setResult] = useState<TranslatorTestResult | null>(null);

  if (isLoading) return <Loading />;
  if (error || !data) return <LoadError message={error?.message} />;

  const { translator } = data;
  const active = translator.active.provider;
  const current = selected ?? active;
  const chosen = translator.options.find((o) => o.id === current) ?? translator.options[0];
  const cloud = chosen.cloud ?? translator.options.find((o) => o.id === active)?.cloud ?? null;

  async function onTest() {
    setResult(null);
    try {
      setResult(await test.mutateAsync({ provider: chosen.id }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Test failed");
    }
  }

  async function onSave() {
    try {
      await save.mutateAsync({ provider: chosen.id });
      setSelected(null);
      setResult(null);
      toast.success(`Translator set to ${chosen.label}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Languages className="h-4 w-4 text-primary" aria-hidden="true" /> Translator
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            French sources are translated to English when they are imported: students can read and listen in either language, and
            English questions find French material. Citations always point at the original.
          </p>
        </div>

        {translator.active.source === "fallback" && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            Azure AI Translator is selected but AZURE_TRANSLATOR_KEY is not set in the server .env; until it is, the local model is used.
          </p>
        )}

        <fieldset className="space-y-2">
          <legend className="sr-only">Translation model</legend>
          {translator.options.map((o) => (
            <OptionRow
              key={o.id}
              name="translator"
              value={o.id}
              checked={o.id === current}
              disabled={!o.configured}
              cloud={o.cloud}
              label={o.label}
              note={o.configured ? o.note : `Set ${o.missingKey} in the server .env to enable.`}
              inUse={o.id === active}
              onSelect={() => {
                setSelected(o.id);
                setResult(null);
              }}
            />
          ))}
        </fieldset>

        {cloud && <CloudWarning provider={cloud} what="the text" />}

        {result && (
          <div role="status" className={cn("space-y-1 text-sm", result.ok ? "text-foreground" : "text-destructive")}>
            <p className="flex items-start gap-2">
              {result.ok ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
              ) : (
                <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              )}
              <span>
                {result.ok ? `${result.translator} answered in ${(result.latencyMs / 1000).toFixed(1)} s.` : `${result.translator}: ${result.error}`}
              </span>
            </p>
            {result.ok && (
              <dl className="grid gap-1 rounded-md bg-muted/40 p-3 text-xs sm:grid-cols-[3rem_1fr]">
                <dt className="font-medium text-muted-foreground">FR</dt>
                <dd>{result.input}</dd>
                <dt className="font-medium text-muted-foreground">EN</dt>
                <dd>{result.output}</dd>
              </dl>
            )}
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onTest} disabled={!chosen.configured || test.isPending}>
            {test.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <PlugZap className="mr-1.5 h-4 w-4" aria-hidden="true" />}
            Test translation
          </Button>
          <Button onClick={onSave} disabled={!chosen.configured || chosen.id === active || save.isPending}>
            {save.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
            Use this translator
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

type TtsOption = SpeechSettings["tts"]["options"][number];

/** Read-aloud model and one voice per language, with a sample to listen to. */
export function TtsCard() {
  const { data, isLoading, error } = useSpeechSettings();
  const save = useSaveTtsChoice();
  const test = useTestTts();
  const [draft, setDraft] = useState<TtsChoiceInput | null>(null);
  const [testing, setTesting] = useState<"en" | "fr" | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      audioRef.current?.pause();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  if (isLoading) return <Loading />;
  if (error || !data) return <LoadError message={error?.message} />;

  const { tts } = data;
  const active: TtsChoiceInput = { provider: tts.active.provider, voices: tts.active.voices };
  const current = draft ?? active;
  const option = tts.options.find((o) => o.id === current.provider) as TtsOption;
  const activeOption = tts.options.find((o) => o.id === active.provider);
  const dirty = current.provider !== active.provider || current.voices.en !== active.voices.en || current.voices.fr !== active.voices.fr;
  const cloud = option.cloud ?? activeOption?.cloud ?? null;

  function choose(o: TtsOption) {
    setDraft({ provider: o.id, voices: o.id === active.provider ? { ...active.voices } : { ...o.defaults } });
  }

  async function onListen(lang: "en" | "fr") {
    setTesting(lang);
    try {
      const { url, latencyMs } = await test.mutateAsync({ choice: current, lang });
      audioRef.current?.pause();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = url;
      audioRef.current = new Audio(url);
      await audioRef.current.play();
      toast.success(`${lang === "en" ? "English" : "French"} sample generated in ${(latencyMs / 1000).toFixed(1)} s`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not generate the sample");
    } finally {
      setTesting(null);
    }
  }

  async function onSave() {
    try {
      await save.mutateAsync(current);
      setDraft(null);
      toast.success(`Read-aloud set to ${option.label}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <AudioLines className="h-4 w-4 text-primary" aria-hidden="true" /> Text to speech
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Reads transcripts and documents aloud on the source page, in French or English. Audio is generated on first play and
            kept with the source.
          </p>
        </div>

        {tts.active.source === "fallback" && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            The selected cloud voice has no key in the server .env (AZURE_SPEECH_KEY or GEMINI_API_KEY); until it is set, Kokoro is used.
          </p>
        )}

        <fieldset className="space-y-2">
          <legend className="sr-only">Text-to-speech model</legend>
          {tts.options.map((o) => (
            <OptionRow
              key={o.id}
              name="tts"
              value={o.id}
              checked={o.id === current.provider}
              disabled={!o.configured}
              cloud={o.cloud}
              label={o.label}
              note={o.configured ? o.note : `Set ${o.missingKey} in the server .env to enable.`}
              inUse={o.id === active.provider}
              onSelect={() => choose(o)}
            />
          ))}
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          {LANGS.map((l) => (
            <div key={l.id} className="space-y-1.5">
              <Label htmlFor={`tts-voice-${l.id}`}>{l.label} voice</Label>
              <div className="flex gap-2">
                <select
                  id={`tts-voice-${l.id}`}
                  value={current.voices[l.id]}
                  onChange={(e) => setDraft({ ...current, voices: { ...current.voices, [l.id]: e.target.value } })}
                  className={selectClass}
                >
                  {option.voices[l.id].map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => onListen(l.id)}
                  disabled={!option.configured || testing !== null}
                  aria-label={`Listen to the ${l.label} voice`}
                  title={`Listen to the ${l.label} voice`}
                >
                  {testing === l.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Volume2 className="h-4 w-4" aria-hidden="true" />}
                </Button>
              </div>
            </div>
          ))}
        </div>

        {cloud && <CloudWarning provider={cloud} what="the text read aloud" />}

        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={onSave} disabled={!option.configured || !dirty || save.isPending}>
            {save.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
            Use these voices
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
