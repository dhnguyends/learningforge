"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, Play, Settings2, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/misc";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * Microphone settings for speaking practice, kept in this browser: which
 * microphone, and the browser's noise suppression, echo cancellation and
 * automatic volume. A level meter and a short test recording check them.
 */
export interface MicSettings {
  deviceId: string | null;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
}

const KEY = "polylingue-mic";
const DEFAULTS: MicSettings = { deviceId: null, noiseSuppression: true, echoCancellation: true, autoGainControl: true };

export function readMicSettings(): MicSettings {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<MicSettings>) };
  } catch {
    return DEFAULTS;
  }
}

function saveMicSettings(s: MicSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* kept for this page */
  }
}

export function audioConstraints(s: MicSettings): MediaTrackConstraints {
  return {
    ...(s.deviceId ? { deviceId: { exact: s.deviceId } } : {}),
    noiseSuppression: s.noiseSuppression,
    echoCancellation: s.echoCancellation,
    autoGainControl: s.autoGainControl,
  };
}

/** True when this window itself forbids the microphone (e.g. a browser panel embedded in another app). */
export function windowBlocksMicrophone(): boolean {
  const policy = (document as Document & { featurePolicy?: { allowsFeature(f: string): boolean } }).featurePolicy;
  return policy ? !policy.allowsFeature("microphone") : false;
}

/** Why recording could not start, in words the learner can act on. */
export function microphoneProblem(err: unknown): string {
  const name = (err as Error | undefined)?.name;
  if (typeof window !== "undefined" && windowBlocksMicrophone()) {
    return "This window does not allow the microphone (for example the browser panel inside the Claude app). Open LearningForge in Chrome, Edge or Firefox to record.";
  }
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "The microphone is blocked for this site: allow it in the browser's site settings (the padlock next to the address), then try again.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No microphone was found. Connect one, or choose another in Micro settings.";
  if (name === "NotReadableError") return "The microphone is used by another app. Close it, then try again.";
  return "The microphone could not be opened. Check Micro settings.";
}

/** The microphone with the saved settings; the default one when the saved microphone is gone. */
export async function openMicrophone(): Promise<MediaStream> {
  const settings = readMicSettings();
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: audioConstraints(settings) });
  } catch (err) {
    if (settings.deviceId && (err as Error).name === "OverconstrainedError") {
      saveMicSettings({ ...settings, deviceId: null });
      return navigator.mediaDevices.getUserMedia({ audio: audioConstraints({ ...settings, deviceId: null }) });
    }
    throw err;
  }
}

/** The "Micro settings" button and its dialog. */
export function MicSettingsButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => setOpen(true)} title="Choose and test the microphone">
        <Settings2 className="h-4 w-4" aria-hidden="true" /> Micro settings
      </Button>
      {open && <MicSettingsDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function MicSettingsDialog({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<MicSettings>(readMicSettings);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [testing, setTesting] = useState<"idle" | "recording" | "ready">("idle");
  const [testUrl, setTestUrl] = useState<string | null>(null);
  const stream = useRef<MediaStream | null>(null);

  // Live input: list the microphones (names need permission) and show the level.
  useEffect(() => {
    let stopped = false;
    let raf = 0;
    let ctx: AudioContext | null = null;
    (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints(settings) });
        if (stopped) return s.getTracks().forEach((t) => t.stop());
        stream.current = s;
        setError(null);
        setDevices((await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput"));
        ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        ctx.createMediaStreamSource(s).connect(analyser);
        const data = new Float32Array(analyser.fftSize);
        const tick = () => {
          analyser.getFloatTimeDomainData(data);
          let sum = 0;
          for (const v of data) sum += v * v;
          setLevel(Math.min(1, Math.sqrt(sum / data.length) * 4));
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch (err) {
        setError(microphoneProblem(err));
      }
    })();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream.current?.getTracks().forEach((t) => t.stop());
      stream.current = null;
      void ctx?.close();
    };
  }, [settings]);

  useEffect(() => () => (testUrl ? URL.revokeObjectURL(testUrl) : undefined), [testUrl]);

  const update = (patch: Partial<MicSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveMicSettings(next);
  };

  async function test() {
    if (!stream.current) return;
    setTesting("recording");
    const rec = new MediaRecorder(stream.current);
    const chunks: BlobPart[] = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.onstop = () => {
      setTestUrl(URL.createObjectURL(new Blob(chunks, { type: rec.mimeType || "audio/webm" })));
      setTesting("ready");
    };
    rec.start();
    setTimeout(() => rec.state === "recording" && rec.stop(), 3000);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mic className="h-5 w-5 text-primary" aria-hidden="true" /> Micro settings
          </DialogTitle>
          <DialogDescription>Saved in this browser and used by every Record button. Speak to see the level move.</DialogDescription>
        </DialogHeader>

        {error ? (
          <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="mic-device">Microphone</Label>
              <select
                id="mic-device"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={settings.deviceId ?? ""}
                onChange={(e) => update({ deviceId: e.target.value || null })}
              >
                <option value="">Default microphone</option>
                {devices
                  .filter((d) => d.deviceId && d.deviceId !== "default")
                  .map((d, i) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Microphone ${i + 1}`}
                    </option>
                  ))}
              </select>
            </div>

            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Input level</p>
              <div className="h-3 overflow-hidden rounded-full bg-muted" role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}>
                <div
                  className={level > 0.85 ? "h-full bg-red-500" : level > 0.05 ? "h-full bg-emerald-500" : "h-full bg-muted-foreground/30"}
                  style={{ width: `${Math.max(2, level * 100)}%`, transition: "width 80ms linear" }}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">Green while you speak; red means too loud (move back a little).</p>
            </div>

            {(
              [
                ["noiseSuppression", "Noise suppression", "Reduces background noise."],
                ["echoCancellation", "Echo cancellation", "Useful with speakers instead of headphones."],
                ["autoGainControl", "Automatic volume", "Evens out a voice that is too quiet or too loud."],
              ] as const
            ).map(([key, label, hint]) => (
              <div key={key} className="flex items-center gap-3">
                <Switch id={`mic-${key}`} checked={settings[key]} onCheckedChange={(v) => update({ [key]: v })} />
                <div>
                  <Label htmlFor={`mic-${key}`} className="text-sm">
                    {label}
                  </Label>
                  <p className="text-xs text-muted-foreground">{hint}</p>
                </div>
              </div>
            ))}

            <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void test()} disabled={testing === "recording"}>
                {testing === "recording" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Mic className="h-4 w-4" aria-hidden="true" />}
                {testing === "recording" ? "Recording 3 s…" : "Test: record 3 seconds"}
              </Button>
              {testUrl && <TestPlayback url={testUrl} />}
            </div>
          </div>
        )}

        <div className="flex justify-end">
          <Button
            onClick={() => {
              toast.success("Microphone settings saved.");
              onClose();
            }}
          >
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TestPlayback({ url }: { url: string }) {
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => audio.current?.pause(), []);
  return (
    <Button
      variant="ghost"
      size="sm"
      className="gap-1.5"
      onClick={() => {
        if (playing) return audio.current?.pause();
        const a = new Audio(url);
        a.onended = () => setPlaying(false);
        a.onpause = () => setPlaying(false);
        audio.current = a;
        void a.play().then(() => setPlaying(true));
      }}
    >
      {playing ? <Square className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
      {playing ? "Stop" : "Play the test"}
    </Button>
  );
}
