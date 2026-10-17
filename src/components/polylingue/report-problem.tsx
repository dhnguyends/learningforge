"use client";

import { useState } from "react";
import { Flag, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/hooks/use-api";

export const REPORT_REASONS = [
  { value: "wrong_answer", label: "The expected answer is wrong" },
  { value: "unclear", label: "The question is unclear" },
  { value: "typo", label: "A spelling or grammar mistake" },
  { value: "audio", label: "The audio is wrong" },
  { value: "other", label: "Something else" },
] as const;

/** "Report a problem" with one exercise: an admin reviews it; 3 reports hide the exercise meanwhile. */
export function ReportProblem({ courseId, lessonId, index }: { courseId: string; lessonId: string; index: number }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>("wrong_answer");
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    try {
      await api(`/api/polylingue/courses/${courseId}/lessons/${lessonId}/report`, {
        method: "POST",
        body: JSON.stringify({ index, reason, comment: comment.trim() || undefined }),
      });
      setSent(true);
      setOpen(false);
      toast.success("Thank you: the problem was reported and will be reviewed.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send the report");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-60"
        onClick={() => setOpen(true)}
        disabled={sent}
      >
        <Flag className="h-3 w-3" aria-hidden="true" /> {sent ? "Reported" : "Report a problem"}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Report a problem</DialogTitle>
            <DialogDescription>What is wrong with this exercise? An administrator reviews it.</DialogDescription>
          </DialogHeader>
          <form className="space-y-3" onSubmit={(e) => void send(e)}>
            <fieldset className="space-y-1.5">
              <legend className="sr-only">Problem</legend>
              {REPORT_REASONS.map((r) => (
                <label key={r.value} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                  <input type="radio" name="reason" value={r.value} checked={reason === r.value} onChange={() => setReason(r.value)} />
                  {r.label}
                </label>
              ))}
            </fieldset>
            <Textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} placeholder="Details (optional)" aria-label="Details" rows={3} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={sending} className="gap-1.5">
                {sending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                Send
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
