"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, BellRing, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/misc";
import { Input } from "@/components/ui/input";
import { useReminders, useUpdateReminders } from "@/hooks/use-polylingue";
import { disablePush, enablePush, pushState, pushSupported, type PushState } from "@/lib/polylingue/pwa-client";

/**
 * Reminders: a daily reminder at a chosen time when the goal is not met yet,
 * "your streak is at risk" in the evening, and the weekly summary on Monday.
 * Always shown in PolyLingue; also as browser notifications when turned on.
 */
export default function PolyRemindersPage() {
  const { data, isLoading, error } = useReminders();
  const update = useUpdateReminders();
  const [push, setPush] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [time, setTime] = useState("19:00");

  useEffect(() => {
    void pushState().then(setPush);
  }, []);
  useEffect(() => {
    if (data) setTime(data.time);
  }, [data]);

  const save = async (input: Parameters<typeof update.mutateAsync>[0]) => {
    try {
      await update.mutateAsync(input);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    }
  };

  async function turnOn() {
    if (!data?.vapidPublicKey) return;
    setBusy(true);
    try {
      const state = await enablePush(data.vapidPublicKey);
      setPush(state);
      if (state === "on") {
        await save({ push: true });
        toast.success("Browser notifications are on for this browser.");
      } else if (state === "denied") toast.error("The browser blocks notifications for this site: allow them in the site settings (padlock in the address bar).");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not turn on notifications");
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    try {
      await disablePush();
      setPush("off");
      await save({ push: false });
      toast.success("Browser notifications are off for this browser.");
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    const res = await fetch("/api/polylingue/push/test", { method: "POST" });
    const body = (await res.json().catch(() => ({}))) as { sent?: number; error?: string };
    if (!res.ok) toast.error(body.error ?? "Could not send");
    else if (!body.sent) toast.error("No browser received it: turn notifications on again.");
    else toast.success("Sent: it should appear in a few seconds.");
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5 px-4 py-6 sm:px-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <Bell className="h-5 w-5 text-primary" aria-hidden="true" /> Reminders
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Reminders appear at the top of PolyLingue. Turn on browser notifications to get them even when PolyLingue is closed.
        </p>
      </div>

      {error ? (
        <p className="text-sm text-destructive">{error.message}</p>
      ) : isLoading || !data ? (
        <div className="h-64 animate-pulse rounded-lg bg-muted" />
      ) : (
        <>
          <Card>
            <CardContent className="divide-y divide-border/60 p-0">
              <Row
                id="daily"
                title="Daily reminder"
                description="When today's goal is not reached yet at this time."
                checked={data.enabled}
                onChange={(v) => void save({ enabled: v })}
              >
                <Input
                  type="time"
                  aria-label="Reminder time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  onBlur={() => time && time !== data.time && void save({ time })}
                  className="h-8 w-28"
                  disabled={!data.enabled}
                />
              </Row>
              <Row
                id="streak"
                title="Streak at risk"
                description="In the evening (from 21:00, 18:00 in the app), when your streak would be lost tonight."
                checked={data.streakWarning}
                onChange={(v) => void save({ streakWarning: v })}
              />
              <Row
                id="summary"
                title="Weekly summary"
                description="On Monday: last week's XP, time, words and what to work on."
                checked={data.weeklySummary}
                onChange={(v) => void save({ weeklySummary: v })}
              />
              <div className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm">
                <span className="text-muted-foreground">Time zone</span>
                <span className="font-medium">{data.timeZone}</span>
                {typeof Intl !== "undefined" && Intl.DateTimeFormat().resolvedOptions().timeZone !== data.timeZone && (
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto p-0"
                    onClick={() => void save({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })}
                  >
                    Use this device&apos;s ({Intl.DateTimeFormat().resolvedOptions().timeZone})
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 p-4">
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <BellRing className="h-4 w-4 text-primary" aria-hidden="true" /> Browser notifications
              </h2>
              {!data.pushAvailable ? (
                <p className="text-sm text-muted-foreground">Not set up on this server (VAPID keys missing): reminders stay in the app.</p>
              ) : !pushSupported() || push === "unsupported" ? (
                <p className="text-sm text-muted-foreground">This browser does not support notifications. On iPhone, install PolyLingue on the home screen first.</p>
              ) : push === "denied" ? (
                <p className="text-sm text-muted-foreground">
                  Notifications are blocked for this site. Allow them in the browser&apos;s site settings (the padlock next to the address), then reload.
                </p>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    {push === "on"
                      ? `On for this browser${data.browsers > 1 ? ` (and ${data.browsers - 1} other${data.browsers > 2 ? "s" : ""})` : ""}. The browser's push service (Google, Mozilla or Apple) carries them, so the device needs internet.`
                      : "Off for this browser. The browser asks your permission first; its push service (Google, Mozilla or Apple) carries the notifications."}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {push === "on" ? (
                      <>
                        <Button variant="outline" className="gap-1.5" onClick={() => void test()}>
                          <Send className="h-4 w-4" aria-hidden="true" /> Send a test
                        </Button>
                        <Button variant="ghost" className="gap-1.5" onClick={() => void turnOff()} disabled={busy}>
                          <BellOff className="h-4 w-4" aria-hidden="true" /> Turn off
                        </Button>
                      </>
                    ) : (
                      <Button className="gap-1.5" onClick={() => void turnOn()} disabled={busy || push === null}>
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <BellRing className="h-4 w-4" aria-hidden="true" />}
                        Turn on notifications
                      </Button>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Row({
  id,
  title,
  description,
  checked,
  onChange,
  children,
}: {
  id: string;
  title: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
      <Switch id={`rem-${id}`} checked={checked} onCheckedChange={onChange} />
      <div className="min-w-0 flex-1">
        <Label htmlFor={`rem-${id}`} className="text-sm font-medium">
          {title}
        </Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  );
}
