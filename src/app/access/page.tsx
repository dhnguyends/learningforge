"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { KeyRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "@/components/shared/auth-form";

export default function AccessPage() {
  return (
    <Suspense fallback={null}>
      <AccessForm />
    </Suspense>
  );
}

/** Only allow same-site relative redirects after unlocking. */
function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

function AccessForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(res.status === 429 ? "Too many attempts — try again later." : body.error ?? "Incorrect access key");
        return;
      }
      router.replace(safeNext(params.get("next")));
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthShell
      title="Private site"
      subtitle="LearningForge is invite-only. Enter the access key you were given."
      footer={<>No key? Ask the site administrator.</>}
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="access-key">Access key</Label>
          <Input
            id="access-key"
            type="password"
            autoComplete="off"
            autoFocus
            required
            value={key}
            onChange={(e) => setKey(e.target.value)}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "access-error" : undefined}
          />
          {error && (
            <p id="access-error" role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <Button type="submit" className="w-full" disabled={pending || key.length === 0}>
          {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <KeyRound className="mr-2 h-4 w-4" aria-hidden="true" />}
          Continue
        </Button>
      </form>
    </AuthShell>
  );
}
