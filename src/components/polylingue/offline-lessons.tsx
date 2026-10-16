"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CloudOff, Download, Loader2, Play, RefreshCw, Trash2, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/misc";
import { Label } from "@/components/ui/label";
import { offlineSupported, pendingResults, removeOffline, saveOffline, savedPackage, type OfflinePackage } from "@/lib/polylingue/pwa-client";

const autoKey = (courseId: string) => `polylingue-offline-auto:${courseId}`;
const readAuto = (courseId: string) => {
  try {
    return localStorage.getItem(autoKey(courseId)) === "1";
  } catch {
    return false;
  }
};

/**
 * "Available offline" on the course page: saves the next lessons with their
 * audio on this device (and keeps them up to date when "Keep up to date" is
 * on), so they can be played without a connection.
 */
export function OfflineCard({ courseId, nextLessonId }: { courseId: string; nextLessonId?: string | null }) {
  const [pkg, setPkg] = useState<OfflinePackage | null>(null);
  const [supported, setSupported] = useState(true);
  const [saving, setSaving] = useState<{ done: number; total: number } | null>(null);
  const [auto, setAuto] = useState(false);
  const [pending, setPending] = useState(0);

  const save = useCallback(
    async (quiet = false) => {
      setSaving({ done: 0, total: 1 });
      try {
        const p = await saveOffline(courseId, (done, total) => setSaving({ done, total }));
        setPkg(p);
        if (!quiet) toast.success(p.lessons.length ? `${p.lessons.length} lesson${p.lessons.length > 1 ? "s" : ""} saved on this device.` : "No lesson ready to save yet.");
      } catch (e) {
        if (!quiet) toast.error(e instanceof Error ? e.message : "Could not save the lessons");
      } finally {
        setSaving(null);
      }
    },
    [courseId],
  );

  useEffect(() => {
    setSupported(offlineSupported());
    setAuto(readAuto(courseId));
    setPending(pendingResults());
    void savedPackage(courseId).then(setPkg);
  }, [courseId]);

  // Keep up to date: refresh when the next lesson changed or the copy is older than an hour.
  useEffect(() => {
    if (!auto || !navigator.onLine || saving) return;
    const stale = !pkg || Date.now() - Date.parse(pkg.savedAt) > 3600_000 || (nextLessonId && pkg.lessons[0]?.player.id !== nextLessonId);
    if (stale) void save(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, nextLessonId, pkg?.savedAt]);

  if (!supported) return null;

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <CloudOff className="h-4 w-4 text-primary" aria-hidden="true" />
          <h2 className="text-base font-semibold">Available offline</h2>
          <span className="text-xs text-muted-foreground">
            {pkg ? `${pkg.lessons.length} lesson${pkg.lessons.length === 1 ? "" : "s"} saved ${new Date(pkg.savedAt).toLocaleString()}` : "Nothing saved on this device"}
          </span>
          <span className="ml-auto flex items-center gap-1">
            <Button size="sm" variant={pkg ? "outline" : "default"} className="h-8 gap-1.5" onClick={() => void save()} disabled={Boolean(saving)}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : pkg ? <RefreshCw className="h-4 w-4" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
              {pkg ? "Update" : "Save the next lessons"}
            </Button>
            {pkg && (
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                aria-label="Remove the saved lessons"
                title="Remove the saved lessons"
                onClick={async () => {
                  await removeOffline(courseId);
                  setPkg(null);
                }}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            )}
          </span>
        </div>
        {saving && <Progress value={(saving.done / Math.max(1, saving.total)) * 100} aria-label="Saving lessons and audio" />}
        {pkg && pkg.lessons.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {pkg.lessons.map((l) => (
              <li key={l.player.id}>
                <Link href={`/polylingue/${courseId}/lesson/${l.player.id}`} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">
                  <Play className="h-3 w-3" aria-hidden="true" /> {l.player.title}
                </Link>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Switch
            id={`offline-auto-${courseId}`}
            checked={auto}
            onCheckedChange={(v) => {
              setAuto(v);
              try {
                localStorage.setItem(autoKey(courseId), v ? "1" : "0");
              } catch {
                /* kept for this page */
              }
            }}
          />
          <Label htmlFor={`offline-auto-${courseId}`} className="text-xs text-muted-foreground">
            Keep up to date on this device (the next 3 lessons and their audio)
          </Label>
          {pending > 0 && <span className="ml-auto text-xs text-amber-600">{pending} offline result{pending > 1 ? "s" : ""} waiting to be sent</span>}
        </div>
      </CardContent>
    </Card>
  );
}

/** The course page without a connection: the lessons saved on this device. */
export function OfflineCourse({ courseId, message }: { courseId: string; message?: string }) {
  const [pkg, setPkg] = useState<OfflinePackage | null | undefined>(undefined);
  useEffect(() => {
    void savedPackage(courseId).then(setPkg);
  }, [courseId]);
  if (pkg === undefined) return <div className="mx-auto mt-6 h-40 max-w-3xl animate-pulse rounded-lg bg-muted" />;
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6 sm:px-6">
      <Card>
        <CardContent className="space-y-3 p-5">
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <WifiOff className="h-5 w-5 text-muted-foreground" aria-hidden="true" /> Offline
          </h1>
          {pkg && pkg.lessons.length > 0 ? (
            <>
              <p className="text-sm text-muted-foreground">These lessons are saved on this device. Your results are sent when you are back online.</p>
              <ul className="divide-y divide-border/60">
                {pkg.lessons.map((l) => (
                  <li key={l.player.id}>
                    <Link href={`/polylingue/${courseId}/lesson/${l.player.id}`} className="flex items-center gap-3 rounded-md px-2 py-2.5 text-sm hover:bg-muted/50">
                      <Play className="h-4 w-4 text-primary" aria-hidden="true" />
                      <span className="flex-1">
                        <span className="block font-medium">{l.player.title}</span>
                        <span className="block text-xs text-muted-foreground">{l.player.unitTitle}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {message ?? "No lesson is saved on this device."} Next time you are online, use “Save the next lessons” on the course page.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
