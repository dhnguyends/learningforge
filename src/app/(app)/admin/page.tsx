"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { Loader2, Pencil, Plus, ShieldCheck, Trash2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAdminUsers, useCreateUser, useDeleteUser, useUpdateUser, type AdminUserRow } from "@/hooks/use-api";
import { AiModelCard } from "@/components/shared/ai-model-card";

type Role = "USER" | "ADMIN";
type EditorState = { mode: "create" } | { mode: "edit"; user: AdminUserRow } | null;

/**
 * Account administration. Self-registration is disabled, so this is the only
 * way accounts are created. Every action is re-authorised server-side against
 * the database role, and the last administrator cannot be removed.
 */
export default function AdminPage() {
  const { data: session } = useSession();
  const { data, isLoading, error } = useAdminUsers();
  const [editor, setEditor] = useState<EditorState>(null);
  const [deleting, setDeleting] = useState<AdminUserRow | null>(null);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" /> Accounts
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            LearningForge is invite-only: create accounts here and share the sign-in details with each person.
          </p>
        </div>
        <Button onClick={() => setEditor({ mode: "create" })}>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> New account
        </Button>
      </div>

      {isLoading ? (
        <div className="h-40 animate-pulse rounded-lg bg-muted" />
      ) : error ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-destructive">{error.message}</CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <caption className="sr-only">Accounts</caption>
              <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Name</th>
                  <th scope="col" className="px-4 py-3 font-medium">Email</th>
                  <th scope="col" className="px-4 py-3 font-medium">Role</th>
                  <th scope="col" className="px-4 py-3 font-medium">Study sets</th>
                  <th scope="col" className="px-4 py-3 font-medium">Created</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {(data?.users ?? []).map((u) => {
                  const isSelf = u.id === session?.user?.id;
                  return (
                    <tr key={u.id} className="border-b border-border/60 last:border-0">
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-2 font-medium">
                          <UserRound className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                          {u.name ?? "—"}
                          {isSelf && <Badge variant="outline" className="text-[10px]">you</Badge>}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{u.email}</td>
                      <td className="px-4 py-3">
                        <Badge variant={u.role === "ADMIN" ? "default" : "secondary"}>{u.role === "ADMIN" ? "Admin" : "User"}</Badge>
                      </td>
                      <td className="px-4 py-3 tabular-nums">{u._count.studySets}</td>
                      <td className="px-4 py-3 text-muted-foreground">{new Date(u.createdAt).toLocaleDateString()}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" onClick={() => setEditor({ mode: "edit", user: u })} aria-label={`Edit ${u.email}`}>
                            <Pencil className="h-4 w-4" aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeleting(u)}
                            disabled={isSelf}
                            title={isSelf ? "You cannot delete your own account" : undefined}
                            aria-label={`Delete ${u.email}`}
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <AiModelCard />

      <UserEditor state={editor} onClose={() => setEditor(null)} />
      <DeleteDialog user={deleting} onClose={() => setDeleting(null)} />
    </div>
  );
}

function UserEditor({ state, onClose }: { state: EditorState; onClose: () => void }) {
  const editing = state?.mode === "edit" ? state.user : null;
  const create = useCreateUser();
  const update = useUpdateUser();
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "USER" as Role });
  const [openedFor, setOpenedFor] = useState<EditorState>(null);

  // Reset the form whenever the dialog opens for a different target.
  if (state !== openedFor) {
    setOpenedFor(state);
    setForm({ name: editing?.name ?? "", email: editing?.email ?? "", password: "", role: editing?.role ?? "USER" });
  }

  const pending = create.isPending || update.isPending;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      if (editing) {
        await update.mutateAsync({
          id: editing.id,
          name: form.name,
          email: form.email,
          role: form.role,
          ...(form.password ? { password: form.password } : {}),
        });
        toast.success("Account updated");
      } else {
        await create.mutateAsync(form);
        toast.success("Account created — share the email and password with its owner");
      }
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Request failed");
    }
  }

  return (
    <Dialog open={state !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit account" : "New account"}</DialogTitle>
            <DialogDescription>
              {editing ? "Leave the password empty to keep the current one." : "The person signs in with this email and password."}
            </DialogDescription>
          </DialogHeader>
          <div className="my-4 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="acct-name">Name</Label>
              <Input id="acct-name" required maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="acct-email">Email</Label>
              <Input id="acct-email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="acct-password">{editing ? "New password (optional)" : "Password"}</Label>
              <Input
                id="acct-password"
                type="password"
                autoComplete="new-password"
                required={!editing}
                minLength={10}
                maxLength={256}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">At least 10 characters.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="acct-role">Role</Label>
              <select
                id="acct-role"
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="USER">User — studies with their own study sets</option>
                <option value="ADMIN">Admin — can also manage accounts</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              {editing ? "Save changes" : "Create account"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({ user, onClose }: { user: AdminUserRow | null; onClose: () => void }) {
  const del = useDeleteUser();
  return (
    <Dialog open={user !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {user?.email}?</DialogTitle>
          <DialogDescription>
            This permanently deletes the account, its {user?._count.studySets ?? 0} study set(s), uploaded files and study history. It
            cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="destructive"
            disabled={del.isPending}
            onClick={() =>
              user &&
              void del
                .mutateAsync(user.id)
                .then(() => {
                  toast.success("Account deleted");
                  onClose();
                })
                .catch((err) => toast.error(err instanceof Error ? err.message : "Delete failed"))
            }
          >
            {del.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            Delete permanently
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
