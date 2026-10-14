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
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Markdown } from "@/components/shared/markdown";
import { ClaimBadge } from "@/components/shared/claim-badge";
import { CitationList, type AnchorData } from "@/components/shared/citation-chip";
import { useTutorConversations, useTutorMessages, useCreateConversation, useSendTutorMessage, type AnchorRef, type TutorMessageRow } from "@/hooks/use-api";
import { cn } from "@/lib/utils";

const MODES: { value: "answer" | "hint" | "explain_differently" | "show_source" | "challenge" | "reveal_solution"; label: string; icon: LucideIcon }[] = [
  { value: "answer", label: "Ask", icon: MessageCirclePlus },
  { value: "hint", label: "Hint", icon: Lightbulb },
  { value: "explain_differently", label: "Explain differently", icon: Repeat },
  { value: "show_source", label: "Show source", icon: Compass },
  { value: "challenge", label: "Challenge me", icon: Brain },
];

const NOT_FOUND_PREFIX = "I cannot find that in your uploaded sources";

export default function TutorPage() {
  const { studySetId } = useParams<{ studySetId: string }>();
  const { data, isLoading } = useTutorConversations(studySetId);
  const create = useCreateConversation(studySetId);
  const [conversationId, setConversationId] = useState<string | null>(null);

  // Stable identity: the auto-select effect below depends on this array.
  const conversations = useMemo(() => data?.conversations ?? [], [data]);
  useEffect(() => {
    if (!conversationId && conversations.length > 0) setConversationId(conversations[0].id);
  }, [conversationId, conversations]);

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
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setConversationId(c.id)}
                  className={cn(
                    "w-full truncate rounded-lg px-3 py-2 text-left text-sm transition-colors",
                    c.id === conversationId ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {c.title}
                </button>
              </li>
            ))}
            {conversations.length === 0 && <li className="px-3 py-2 text-xs text-muted-foreground">No conversations yet</li>}
          </ul>
        )}
      </div>

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

  const [input, setInput] = useState("");
  const [mode, setMode] = useState<(typeof MODES)[number]["value"]>("answer");
  const [confirmReveal, setConfirmReveal] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const messages = useMemo(
    () => (data?.conversation.messages ?? []).filter((m) => m.role !== "SYSTEM"),
    [data],
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, send.isPending]);

  async function doSend(m: typeof mode) {
    const content = input.trim();
    if (!content) return;
    try {
      await send.mutateAsync({ content, mode: m });
      setInput("");
      setMode("answer");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Message failed");
    }
  }

  return (
    <Card className="flex h-[calc(100vh-14rem)] min-h-[480px] flex-col">
      <div className="scroll-thin flex-1 space-y-4 overflow-y-auto p-4">
        {isLoading ? (
          <div className="h-40 animate-pulse rounded-lg bg-muted" />
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
            <Sparkles className="h-5 w-5 text-primary" aria-hidden="true" />
            <p>Ask about a derivation, a claim, a slide — anything in your sources.</p>
          </div>
        ) : (
          messages.map((m) => <TutorMessage key={m.id} message={m} studySetId={studySetId} />)
        )}
        {send.isPending && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Consulting your sources…
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Controls */}
      <div className="space-y-2 border-t border-border p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              aria-pressed={mode === m.value}
              onClick={() => setMode(m.value)}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors",
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
            placeholder={MODES.find((m) => m.value === mode)?.label === "Ask" ? "Ask about your material…" : `Ask for a ${MODES.find((m) => m.value === mode)?.label.toLowerCase()} about…`}
            aria-label="Message the tutor"
            className="flex-1 resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button onClick={() => void doSend(mode)} disabled={send.isPending || !input.trim()} aria-label="Send message">
            {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Hints first, solutions on request. The tutor won&apos;t invent what isn&apos;t in your sources.
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

function TutorMessage({ message, studySetId }: { message: TutorMessageRow; studySetId: string }) {
  const isUser = message.role === "USER";
  const notFound = !isUser && message.content.trim().startsWith(NOT_FOUND_PREFIX);
  const anchors = anchorsFrom(message.anchors);

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground">
          <p className="whitespace-pre-wrap">{message.content}</p>
          {message.mode && message.mode !== "answer" && (
            <p className="mt-1 text-[11px] opacity-75">mode: {message.mode.replace(/_/g, " ")}</p>
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
        {!notFound && message.claimType ? <ClaimBadge type={message.claimType as never} compact /> : null}
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
      </div>
    </div>
  );
}
