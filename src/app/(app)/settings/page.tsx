"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { AlertTriangle, Download, Loader2, Moon, Sun, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/hooks/use-api";

export default function SettingsPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const { setTheme, resolvedTheme } = useTheme();
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);

  async function onExport() {
    setExporting(true);
    try {
      const res = await fetch("/api/account/export");
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `lectureforge-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Export downloaded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  async function onDelete() {
    if (confirmText !== "DELETE MY ACCOUNT") {
      toast.error("Type DELETE MY ACCOUNT to confirm");
      return;
    }
    setDeleting(true);
    try {
      await api("/api/account/delete", { method: "POST", body: JSON.stringify({ confirm: confirmText }) });
      toast.success("Account deleted. Goodbye.");
      await signOut({ callbackUrl: "/" });
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
      setDeleting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8 sm:px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Signed in as {session?.user?.email}</p>
      </div>

      {/* Appearance */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Appearance</CardTitle>
          <CardDescription>Reading comfort for long study sessions.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Theme</p>
              <p className="text-xs text-muted-foreground">Currently {resolvedTheme}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            >
              {resolvedTheme === "dark" ? <Sun className="h-3.5 w-3.5" aria-hidden="true" /> : <Moon className="h-3.5 w-3.5" aria-hidden="true" />}
              Switch to {resolvedTheme === "dark" ? "light" : "dark"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Data ownership */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your data</CardTitle>
          <CardDescription>You own your content. Export it or remove it — permanently — at any time.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-4">
            <div>
              <p className="text-sm font-medium">Export everything</p>
              <p className="text-xs text-muted-foreground">
                A JSON archive of your study sets, sources-derived content, transcripts, cards, quizzes, attempts, and progress.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => void onExport()} disabled={exporting} className="gap-1.5">
              {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Download className="h-3.5 w-3.5" aria-hidden="true" />}
              Download export
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Danger zone */}
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-destructive">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" /> Delete account
          </CardTitle>
          <CardDescription>
            Permanently deletes your account, all workspaces, every uploaded source (including stored files), and all
            generated material. This cannot be undone.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="confirm">Type “DELETE MY ACCOUNT” to confirm</Label>
            <Input
              id="confirm"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE MY ACCOUNT"
              aria-describedby="confirm-help"
              className="font-mono"
            />
            <p id="confirm-help" className="text-xs text-muted-foreground">
              Deletion first purges stored files, then cascades every database row.
            </p>
          </div>
          <Button variant="destructive" onClick={() => void onDelete()} disabled={deleting || confirmText !== "DELETE MY ACCOUNT"} className="gap-1.5">
            {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
            Delete my account permanently
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
