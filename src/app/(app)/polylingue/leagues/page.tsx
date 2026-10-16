"use client";

import { useState } from "react";
import { Copy, Crown, LogOut, Medal, Plus, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { cn } from "@/lib/utils";
import { useCreateLeague, useJoinLeague, useLeagues, useLeaveLeague } from "@/hooks/use-polylingue";

/**
 * Friends' leagues: weekly XP (all languages) among learners who share an
 * invite code. Opt-in, with a nickname; nobody else sees the ranking.
 */
export default function PolyLeaguesPage() {
  const { data, isLoading, error } = useLeagues();
  const leave = useLeaveLeague();
  const confirm = useConfirm();
  const [dialog, setDialog] = useState<"create" | "join" | null>(null);

  const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short" });

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <Users className="h-5 w-5 text-primary" aria-hidden="true" /> Leagues
          </h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Compare this week&apos;s XP with friends. Only people with the invite code can join; they see your nickname and weekly XP, nothing
            else.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-1.5" onClick={() => setDialog("join")}>
            <UserPlus className="h-4 w-4" aria-hidden="true" /> Join with a code
          </Button>
          <Button className="gap-1.5" onClick={() => setDialog("create")}>
            <Plus className="h-4 w-4" aria-hidden="true" /> New league
          </Button>
        </div>
      </div>

      {error ? (
        <p className="text-sm text-destructive">{error.message}</p>
      ) : isLoading || !data ? (
        <div className="h-48 animate-pulse rounded-lg bg-muted" />
      ) : data.leagues.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            You are in no league yet. Create one and share its code with friends or classmates, or join theirs.
          </CardContent>
        </Card>
      ) : (
        data.leagues.map((l) => (
          <Card key={l.id}>
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold">{l.name}</h2>
                <span className="text-xs text-muted-foreground">
                  Week of {fmt(data.week.start)} – {fmt(data.week.end)} · you are “{l.nickname}”
                </span>
                <span className="ml-auto flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 font-mono"
                    title="Copy the invite code"
                    onClick={() => {
                      void navigator.clipboard?.writeText(l.code);
                      toast.success(`Invite code ${l.code} copied.`);
                    }}
                  >
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" /> {l.code}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1.5 text-muted-foreground"
                    onClick={async () => {
                      const ok = await confirm({
                        title: `Leave “${l.name}”?`,
                        description: l.ranking.length === 1 ? "You are its last member: the league is deleted." : "You can join again later with its code.",
                        confirmLabel: "Leave",
                        destructive: true,
                      });
                      if (!ok) return;
                      try {
                        await leave.mutateAsync(l.id);
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : "Could not leave the league");
                      }
                    }}
                  >
                    <LogOut className="h-3.5 w-3.5" aria-hidden="true" /> Leave
                  </Button>
                </span>
              </div>

              <ol className="divide-y divide-border/60" aria-label={`Ranking of ${l.name} this week`}>
                {l.ranking.map((r) => (
                  <li key={r.memberId} className={cn("flex items-center gap-3 px-2 py-2 text-sm", r.you && "rounded-md bg-primary/5 font-medium")}>
                    <span className="w-7 text-center tabular-nums text-muted-foreground">
                      {r.rank === 1 && r.xp > 0 ? <Crown className="mx-auto h-4 w-4 text-amber-500" aria-label="First" /> : r.rank}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {r.nickname}
                      {r.you && <span className="ml-1 text-xs text-muted-foreground">(you)</span>}
                    </span>
                    <span className="tabular-nums">{r.xp} XP</span>
                  </li>
                ))}
              </ol>

              {l.lastWeekPodium.length > 0 && (
                <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Medal className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" /> Last week:
                  {l.lastWeekPodium.map((r) => (
                    <span key={r.memberId}>
                      {r.rank}. {r.nickname} ({r.xp} XP)
                    </span>
                  ))}
                </p>
              )}
            </CardContent>
          </Card>
        ))
      )}

      <LeagueDialog mode={dialog} onClose={() => setDialog(null)} />
    </div>
  );
}

function LeagueDialog({ mode, onClose }: { mode: "create" | "join" | null; onClose: () => void }) {
  const create = useCreateLeague();
  const join = useJoinLeague();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [nickname, setNickname] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const busy = create.isPending || join.isPending;

  const close = () => {
    setName("");
    setCode("");
    setCreated(null);
    onClose();
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      if (mode === "create") {
        const r = await create.mutateAsync({ name: name.trim(), nickname: nickname.trim() });
        setCreated(r.code);
      } else {
        const r = await join.mutateAsync({ code, nickname: nickname.trim() });
        toast.success(`You joined “${r.name}”.`);
        close();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  return (
    <Dialog open={mode !== null} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "New league" : "Join a league"}</DialogTitle>
          <DialogDescription>
            {mode === "create" ? "Friends join with the code you get. Rankings restart every Monday." : "Type the code a friend shared with you."}
          </DialogDescription>
        </DialogHeader>
        {created ? (
          <div className="space-y-3 text-center">
            <p className="text-sm text-muted-foreground">Share this code:</p>
            <p className="font-mono text-3xl font-semibold tracking-widest">{created}</p>
            <div className="flex justify-center gap-2">
              <Button
                variant="outline"
                className="gap-1.5"
                onClick={() => {
                  void navigator.clipboard?.writeText(created);
                  toast.success("Code copied.");
                }}
              >
                <Copy className="h-4 w-4" aria-hidden="true" /> Copy
              </Button>
              <Button onClick={close}>Done</Button>
            </div>
          </div>
        ) : (
          <form className="space-y-3" onSubmit={(e) => void submit(e)}>
            {mode === "create" ? (
              <div className="space-y-1.5">
                <Label htmlFor="league-name">League name</Label>
                <Input id="league-name" value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={40} required placeholder="Spanish club" />
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="league-code">Invite code</Label>
                <Input
                  id="league-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  required
                  placeholder="K7Q-2MX"
                  className="font-mono uppercase tracking-widest"
                  autoComplete="off"
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="league-nickname">Your nickname in this league</Label>
              <Input id="league-nickname" value={nickname} onChange={(e) => setNickname(e.target.value)} minLength={2} maxLength={24} required placeholder="Alex" />
              <p className="text-xs text-muted-foreground">Shown to the other members instead of your name or e-mail.</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {mode === "create" ? "Create" : "Join"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
