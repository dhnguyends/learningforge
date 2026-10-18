"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  Bot,
  Brain,
  Compass,
  Lightbulb,
  Loader2,
  MessageCirclePlus,
  Repeat,
  Send,
  ShieldAlert,
  Sparkles,
  Eye,
  Globe,
  MoreHorizontal,
  Pencil,
  Timer,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/misc";
import { Input } from "@/components/ui/input";
import { DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { PointerMenu, isMenuKey, menuPoint, type MenuPoint } from "@/components/shared/pointer-menu";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Markdown } from "@/components/shared/markdown";
import { ClaimBadge } from "@/components/shared/claim-badge";
import { CitationList, type AnchorData } from "@/components/shared/citation-chip";
import {
  useTutorConversations,
  useTutorMessages,
  useCreateConversation,
  useDeleteConversation,
  useRenameConversation,
  useSendTutorMessage,
  useSaveAnswerTime,
  useActiveAi,
  type AnchorRef,
  type TutorMessageRow,
} from "@/hooks/use-api";
import { cn, formatTimestamp } from "@/lib/utils";
import { serverAnswerTimes } from "@/lib/tutor-timing";

const MODES: { value: "answer" | "hint" | "explain_differently" | "show_source" | "challenge" | "reveal_solution"; label: string; icon: LucideIcon }[] = [
  { value: "answer", label: "Ask", icon: MessageCirclePlus },
  { value: "hint", label: "Hint", icon: Lightbulb },
  { value: "explain_differently", label: "Explain differently", icon: Repeat },
  { value: "show_source", label: "Show source", icon: Compass },
  { value: "challenge", label: "Challenge me", icon: Brain },
];

const NOT_FOUND_PREFIX = "I cannot find that in your uploaded sources";

/** The "Search my sources" switch, remembered per study set in this browser. */
function useSourceSearch(studySetId: string): [boolean, (on: boolean) => void] {
  const key = `tutor-source-search:${studySetId}`;
  const [on, setOn] = useState(true);
  useEffect(() => {
    try {
      setOn(localStorage.getItem(key) !== "off");
    } catch {
      // Storage blocked: the switch starts on.
    }
  }, [key]);
  const change = (value: boolean) => {
    setOn(value);
    try {
      localStorage.setItem(key, value ? "on" : "off");
    } catch {
      // Not remembered; it still applies to this page.
    }
  };
  return [on, change];
}

export default function TutorPage() {
  const { studySetId } = useParams<{ studySetId: string }>();
  const { data, isLoading } = useTutorConversations(studySetId);
  const create = useCreateConversation(studySetId);
  const rename = useRenameConversation(studySetId);
  const remove = useDeleteConversation(studySetId);
  const confirm = useConfirm();
  const [conversationId, setConversationId] = useState<string | null>(null);
  // Right-click (or Shift+F10, or the ⋯ button) on a conversation: rename, delete.
  const [menu, setMenu] = useState<(MenuPoint & { id: string; title: string }) | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);

  // Stable identity: the auto-select effect below depends on this array.
  const conversations = useMemo(() => data?.conversations ?? [], [data]);
  useEffect(() => {
    if (!conversationId && conversations.length > 0) setConversationId(conversations[0].id);
  }, [conversationId, conversations]);

  async function saveTitle() {
    if (!renaming) return;
    const title = renaming.title.trim();
    if (!title) return;
    try {
      await rename.mutateAsync({ id: renaming.id, title });
      setRenaming(null);
      toast.success("Conversation renamed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not rename the conversation");
    }
  }

  async function deleteConversation(id: string, title: string) {
    const ok = await confirm({
      title: "Delete this conversation?",
      description: `"${title}" and all its messages are deleted. This cannot be undone.`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(id);
      if (id === conversationId) setConversationId(null); // the next one is selected
      toast.success("Conversation deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete the conversation");
    }
  }

  async function newConversation() {
    try {
      const res = await create.mutateAsync(undefined);
      setConversationId(res.conversation.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start conversation");
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
      {/* Conversations */}
      <div className="space-y-2">
        <Button variant="outline" size="sm" className="w-full gap-1.5" onClick={() => void newConversation()} disabled={create.isPending}>
          {create.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <MessageCirclePlus className="h-3.5 w-3.5" aria-hidden="true" />}
          New conversation
        </Button>
        {isLoading ? (
          <div className="h-24 animate-pulse rounded-lg bg-muted" />
        ) : (
          <ul className="space-y-1">
            {conversations.map((c) => (
              <li key={c.id} className="group relative">
                <button
                  type="button"
                  onClick={() => setConversationId(c.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({ ...menuPoint(e), id: c.id, title: c.title });
                  }}
                  onKeyDown={(e) => {
                    if (!isMenuKey(e)) return;
                    e.preventDefault();
                    setMenu({ ...menuPoint(e), id: c.id, title: c.title });
                  }}
                  title={`${c.title} (right-click to rename or delete)`}
                  className={cn(
                    "w-full truncate rounded-lg py-2 pl-3 pr-8 text-left text-sm transition-colors",
                    c.id === conversationId ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {c.title}
                </button>
                <button
                  type="button"
                  aria-label={`Actions for ${c.title}`}
                  onClick={(e) => setMenu({ ...menuPoint({ currentTarget: e.currentTarget }), id: c.id, title: c.title })}
                  className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                </button>
              </li>
            ))}
            {conversations.length === 0 && <li className="px-3 py-2 text-xs text-muted-foreground">No conversations yet</li>}
          </ul>
        )}
      </div>

      <PointerMenu at={menu} onClose={() => setMenu(null)}>
        {menu && (
          <>
            <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">{menu.title}</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => setRenaming({ id: menu.id, title: menu.title })}>
              <Pencil className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> Rename…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => void deleteConversation(menu.id, menu.title)}>
              <Trash2 className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> Delete…
            </DropdownMenuItem>
          </>
        )}
      </PointerMenu>

      <Dialog open={renaming !== null} onOpenChange={(open) => !open && setRenaming(null)}>
        <DialogContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void saveTitle();
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>Rename the conversation</DialogTitle>
              <DialogDescription>A short title to find it again in the list.</DialogDescription>
            </DialogHeader>
            <Input
              aria-label="Conversation title"
              value={renaming?.title ?? ""}
              maxLength={120}
              autoFocus
              onChange={(e) => setRenaming((r) => (r ? { ...r, title: e.target.value } : r))}
            />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setRenaming(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!renaming?.title.trim() || rename.isPending}>
                {rename.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
                Rename
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Thread */}
      {conversationId ? (
        <TutorThread studySetId={studySetId} conversationId={conversationId} />
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="rounded-full bg-primary/10 p-3 text-primary"><Bot className="h-6 w-6" aria-hidden="true" /></div>
            <div>
              <p className="font-medium">Ask anything about this material</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                The tutor answers from your sources with citations, leads with hints, and tells you plainly when
                something isn&apos;t in your uploads.
              </p>
            </div>
            <Button onClick={() => void newConversation()} disabled={create.isPending}>Start a conversation</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** "Answered by DeepSeek-R1 8B · local (deepseek-r1:8b)"; older answers recorded the provider only. */
function answeredBy(meta: TutorMessageRow["metadata"]): string {
  if (meta?.modelLabel && meta.model) return `Answered by ${meta.modelLabel} (${meta.model})`;
  if (meta?.model) return `Answered by ${meta.model}`;
  if (meta?.provider) return `Answered by a ${meta.provider} model (exact model not recorded)`;
  return "AI model not recorded for this answer";
}

/** Tooltip on a tutor timer: which model answers or answered, and what the time measures. */
function TimerTip({ lines, children }: { lines: string[]; children: React.ReactNode }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">
          <p className="font-medium">{lines[0]}</p>
          {lines.slice(1).map((l) => (
            <p key={l} className="opacity-80">{l}</p>
          ))}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function anchorsFrom(refs: AnchorRef[] | undefined): AnchorData[] {
  return (refs ?? []).map((a) => ({
    id: a.id,
    sourceId: a.sourceId,
    sourceTitle: a.source?.title ?? "Source",
    sourceType: a.source?.type ?? "",
    startMs: a.startMs,
    endMs: a.endMs,
    page: a.page,
    excerpt: a.excerpt,
  }));
}

function TutorThread({ studySetId, conversationId }: { studySetId: string; conversationId: string }) {
  const { data, isLoading } = useTutorMessages(conversationId);
  const send = useSendTutorMessage(studySetId, conversationId);
  const saveTime = useSaveAnswerTime(conversationId);

  const [input, setInput] = useState("");
  const [mode, setMode] = useState<(typeof MODES)[number]["value"]>("answer");
  const [sourceSearch, setSourceSearch] = useSourceSearch(studySetId);
  const [confirmReveal, setConfirmReveal] = useState(false);
  // Timer: from sending the question until the answer is on screen.
  const [waiting, setWaiting] = useState<{ startedAt: number; replyId: string | null } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [measured, setMeasured] = useState<Record<string, number>>({});
  const bottomRef = useRef<HTMLDivElement>(null);

  const messages = useMemo(
    () => (data?.conversation.messages ?? []).filter((m) => m.role !== "SYSTEM"),
    [data],
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, send.isPending, waiting]);

  // Ticks every second while the tutor is answering.
  useEffect(() => {
    if (!waiting) return;
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [waiting]);

  // Stops once the answer is rendered: the frame after it appears in the thread.
  useEffect(() => {
    if (!waiting?.replyId || !messages.some((m) => m.id === waiting.replyId)) return;
    const { replyId, startedAt } = waiting;
    const frame = requestAnimationFrame(() => {
      const displayedMs = Date.now() - startedAt;
      setMeasured((prev) => ({ ...prev, [replyId]: displayedMs }));
      setWaiting(null);
      // Kept with the answer, so the next session shows the same time.
      saveTime.mutate({ messageId: replyId, displayedMs });
    });
    return () => cancelAnimationFrame(frame);
    // saveTime is a new object each render; the effect must not re-run for it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, waiting]);

  const recorded = useMemo(() => serverAnswerTimes(messages), [messages]);
  const activeAi = useActiveAi();

  async function doSend(m: typeof mode) {
    const content = input.trim();
    if (!content) return;
    const startedAt = Date.now();
    setWaiting({ startedAt, replyId: null });
    try {
      const res = await send.mutateAsync({ content, mode: m, sourceSearch });
      setWaiting((w) => (w && w.startedAt === startedAt ? { ...w, replyId: res.reply.messageId } : w));
      setInput("");
      setMode("answer");
    } catch (err) {
      setWaiting(null);
      toast.error(err instanceof Error ? err.message : "Message failed");
    }
  }

  return (
    <Card className="flex h-[calc(100vh-14rem)] min-h-[480px] flex-col">
      <div className="scroll-thin flex-1 space-y-4 overflow-y-auto p-4">
        {isLoading ? (
          <div className="h-40 animate-pulse rounded-lg bg-muted" />
        ) : messages.length === 0 && !waiting ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
            <Sparkles className="h-5 w-5 text-primary" aria-hidden="true" />
            <p>Ask about a derivation, a claim, a slide — anything in your sources.</p>
          </div>
        ) : (
          messages.map((m) => (
            <TutorMessage
              key={m.id}
              message={m}
              studySetId={studySetId}
              elapsed={
                measured[m.id] != null
                  ? { ms: measured[m.id], onScreen: true }
                  : typeof m.metadata?.displayedMs === "number"
                    ? { ms: m.metadata.displayedMs, onScreen: true } // saved in an earlier session
                    : recorded[m.id] != null
                      ? { ms: recorded[m.id], onScreen: false }
                      : null
              }
            />
          ))
        )}
        {waiting && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> {sourceSearch ? "Consulting your sources…" : "Thinking (sources not searched)…"}
            <TimerTip
              lines={[
                activeAi.data ? `Answering with ${activeAi.data.label} (${activeAi.data.model})` : "Answering with the AI model chosen at /admin",
                "Time since you sent your question",
              ]}
            >
              <span className="inline-flex items-center gap-1 font-mono tabular-nums text-foreground" aria-label="Time elapsed" tabIndex={0}>
                <Timer className="h-3.5 w-3.5" aria-hidden="true" />
                {formatTimestamp(Math.max(0, now - waiting.startedAt), true)}
              </span>
            </TimerTip>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Controls */}
      <div className="space-y-2 border-t border-border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor="tutor-source-search" className="flex cursor-pointer items-center gap-2 text-xs font-medium">
            <Switch
              id="tutor-source-search"
              checked={sourceSearch}
              onCheckedChange={(on) => {
                setSourceSearch(on);
                if (!on && mode === "show_source") setMode("answer");
              }}
            />
            Search my sources
          </label>
          <span className={cn("text-[11px]", sourceSearch ? "text-muted-foreground" : "text-[hsl(var(--warning))]")}>
            {sourceSearch
              ? "On: answers come from your sources, with citations."
              : "Off: your question is sent without your sources; answers come from general knowledge, without citations."}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              aria-pressed={mode === m.value}
              onClick={() => setMode(m.value)}
              disabled={m.value === "show_source" && !sourceSearch}
              title={m.value === "show_source" && !sourceSearch ? "Needs source search" : undefined}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                mode === m.value ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40",
              )}
            >
              <m.icon className="h-3 w-3" aria-hidden="true" /> {m.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => input.trim() && setConfirmReveal(true)}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors",
              "border-destructive/40 text-destructive hover:bg-destructive/10",
            )}
            title="Full solutions appear only when explicitly requested"
          >
            <Eye className="h-3 w-3" aria-hidden="true" /> Reveal solution
          </button>
        </div>
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void doSend(mode);
              }
            }}
            rows={Math.min(4, Math.max(1, input.split("\n").length))}
            placeholder={
              !sourceSearch
                ? "Ask anything (your sources are not searched)…"
                : MODES.find((m) => m.value === mode)?.label === "Ask"
                  ? "Ask about your material…"
                  : `Ask for a ${MODES.find((m) => m.value === mode)?.label.toLowerCase()} about…`
            }
            aria-label="Message the tutor"
            className="flex-1 resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button onClick={() => void doSend(mode)} disabled={send.isPending || !input.trim()} aria-label="Send message">
            {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {sourceSearch
            ? "Hints first, solutions on request. The tutor won't invent what isn't in your sources."
            : "Hints first, solutions on request. General knowledge may differ from your course: turn source search on to check."}
        </p>
      </div>

      <Dialog open={confirmReveal} onOpenChange={setConfirmReveal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ShieldAlert className="h-4 w-4 text-[hsl(var(--warning))]" aria-hidden="true" /> Reveal the full solution?</DialogTitle>
            <DialogDescription>
              The tutor will give the complete worked answer for: “{input.trim().slice(0, 120)}”. Try hints first —
              solutions stick better after your own attempt.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmReveal(false)}>Keep hinting</Button>
            <Button
              onClick={() => {
                setConfirmReveal(false);
                void doSend("reveal_solution");
              }}
            >
              <Eye className="mr-1.5 h-4 w-4" aria-hidden="true" /> Reveal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function TutorMessage({
  message,
  studySetId,
  elapsed,
}: {
  message: TutorMessageRow;
  studySetId: string;
  /** Time to answer: measured until on screen (this page), or as recorded by the server. */
  elapsed: { ms: number; onScreen: boolean } | null;
}) {
  const isUser = message.role === "USER";
  const general = message.metadata?.sourceSearch === false;
  const notFound = !isUser && !general && message.content.trim().startsWith(NOT_FOUND_PREFIX);
  const anchors = anchorsFrom(message.anchors);

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground">
          <p className="whitespace-pre-wrap">{message.content}</p>
          {((message.mode && message.mode !== "answer") || general) && (
            <p className="mt-1 text-[11px] opacity-75">
              {[message.mode && message.mode !== "answer" ? `mode: ${message.mode.replace(/_/g, " ")}` : null, general ? "sources not searched" : null]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div
        className={cn(
          "max-w-[90%] space-y-2.5 rounded-2xl rounded-bl-sm border bg-card px-4 py-3",
          notFound ? "border-dashed border-border" : "border-border",
        )}
      >
        {general ? (
          <Badge variant="outline" className="gap-1 bg-muted text-muted-foreground" title="Source search was off for this answer">
            <Globe className="h-3 w-3" aria-hidden="true" /> General knowledge · sources not searched
          </Badge>
        ) : !notFound && message.claimType ? (
          <ClaimBadge type={message.claimType as never} compact />
        ) : null}
        {notFound && (
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" /> Not in your sources — stated honestly
          </p>
        )}
        <Markdown content={message.content} />
        {anchors.length > 0 && <CitationList anchors={anchors} studySetId={studySetId} max={4} size="sm" />}
        {message.hintsUsed > 0 && (
          <Badge variant="muted" className="text-[10px]">{message.hintsUsed} hints used</Badge>
        )}
        {elapsed && (
          <TimerTip lines={[answeredBy(message.metadata), elapsed.onScreen ? "From sending your question to the answer on screen" : "From your question to the answer, as recorded by the server"]}>
            <p className="flex w-fit items-center gap-1 text-[11px] text-muted-foreground" tabIndex={0} aria-label={`${formatTimestamp(elapsed.ms, true)} to answer. ${answeredBy(message.metadata)}`}>
              <Timer className="h-3 w-3" aria-hidden="true" />
              <span className="font-mono tabular-nums">{formatTimestamp(elapsed.ms, true)}</span>
            </p>
          </TimerTip>
        )}
      </div>
    </div>
  );
}
