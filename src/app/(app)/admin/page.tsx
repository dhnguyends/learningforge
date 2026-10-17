"use client";

import { Suspense, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { Bot, BookOpen, Cpu, Database, Languages, Loader2, Network, Pencil, Plus, ShieldCheck, ShieldPlus, Trash2, UserRound, Users } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAdminUsers, useCreateUser, useDeleteUser, useUpdateUser, type AdminUserRow } from "@/hooks/use-api";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AiModelCard } from "@/components/shared/ai-model-card";
import { TranslatorCard, TtsCard } from "@/components/shared/speech-model-cards";
import { AdminCourses } from "@/components/shared/admin-courses";
import { AdminCourseTree } from "@/components/shared/admin-course-tree";
import { AdminDatabase } from "@/components/shared/admin-database";
import { useConfirm } from "@/components/shared/confirm-dialog";

type Role = "USER" | "TEACHER" | "ADMIN";
type Nature = "HUMAN" | "BOT";

const ADMIN_NEEDS_HUMAN = "Only Human accounts can be promoted to Admin — change the nature to Human first.";

/** "just now", "12 min ago", "3 h ago", "5 days ago", or the date for older activity. */
function lastUsed(iso: string | null): string {
  if (!iso) return "Never";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 2) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h ago`;
  if (minutes < 14 * 24 * 60) return `${Math.round(minutes / (24 * 60))} days ago`;
  return new Date(iso).toLocaleDateString();
}
type EditorState = { mode: "create" } | { mode: "edit"; user: AdminUserRow } | null;

const TABS = ["users", "ai", "courses", "tree", "database"] as const;
type Tab = (typeof TABS)[number];

/**
 * Administration, in tabs: user accounts, the AI model used for generation,
 * courses (every study set and its owner), the courses tree (maintain
 * Discipline › Subject › Course / Module › Topic) and the vector database. Every action is
 * re-authorised server-side against the database role. The open tab is kept
 * in the URL (?tab=) so it survives reloads and can be linked to.
 */
export default function AdminPage() {
  return (
    <Suspense fallback={null}>
      <AdminTabs />
    </Suspense>
  );
}

function AdminTabs() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const requested = params.get("tab");
  const tab: Tab = TABS.includes(requested as Tab) ? (requested as Tab) : "users";

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" /> Administration
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Accounts, the AI model, courses and the vector database of this LearningForge instance.</p>
        </div>
        <Button asChild variant="outline" className="gap-1.5">
          <Link href="/polylingue" title="Open PolyLingue, the language-learning app">
            <Languages className="h-4 w-4" aria-hidden="true" /> PolyLingue
          </Link>
        </Button>
      </div>
      <Tabs value={tab} onValueChange={(next) => router.replace(`${pathname}?tab=${next}`, { scroll: false })}>
        <TabsList>
          <TabsTrigger value="users" className="gap-1.5">
            <Users className="h-3.5 w-3.5" aria-hidden="true" /> Users
          </TabsTrigger>
          <TabsTrigger value="ai" className="gap-1.5">
            <Cpu className="h-3.5 w-3.5" aria-hidden="true" /> AI model
          </TabsTrigger>
          <TabsTrigger value="courses" className="gap-1.5">
            <BookOpen className="h-3.5 w-3.5" aria-hidden="true" /> Courses
          </TabsTrigger>
          <TabsTrigger value="tree" className="gap-1.5">
            <Network className="h-3.5 w-3.5" aria-hidden="true" /> Courses Tree
          </TabsTrigger>
          <TabsTrigger value="database" className="gap-1.5">
            <Database className="h-3.5 w-3.5" aria-hidden="true" /> Database
          </TabsTrigger>
        </TabsList>
        <TabsContent value="users" className="mt-4">
          <UsersPanel />
        </TabsContent>
        <TabsContent value="ai" className="mt-4">
          <div className="space-y-4">
            <AiModelCard />
            <TranslatorCard />
            <TtsCard />
          </div>
        </TabsContent>
        <TabsContent value="courses" className="mt-4">
          <AdminCourses />
        </TabsContent>
        <TabsContent value="tree" className="mt-4">
          <AdminCourseTree />
        </TabsContent>
        <TabsContent value="database" className="mt-4">
          <AdminDatabase />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * Account administration. Self-registration is disabled, so this is the only
 * way accounts are created, and the last administrator cannot be removed.
 */
function UsersPanel() {
  const { data: session } = useSession();
  const { data, isLoading, error } = useAdminUsers();
  const [editor, setEditor] = useState<EditorState>(null);
  const [deleting, setDeleting] = useState<AdminUserRow | null>(null);
  const update = useUpdateUser();
  const confirm = useConfirm();

  async function promote(u: AdminUserRow) {
    const ok = await confirm({
      title: "Promote to Admin?",
      description: `${u.name ?? u.email} will be able to manage accounts, the AI model and courses. The change applies at once.`,
      confirmLabel: "Promote to Admin",
    });
    if (!ok) return;
    try {
      await update.mutateAsync({ id: u.id, role: "ADMIN" });
      toast.success(`${u.name ?? u.email} is now an Admin`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Promotion failed");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Accounts</h2>
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
                  <th scope="col" className="px-4 py-3 font-medium">Nature</th>
                  <th scope="col" className="px-4 py-3 font-medium">Study sets</th>
                  <th scope="col" className="px-4 py-3 font-medium">Last used</th>
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
                          {u.nature === "BOT" ? (
                            <Bot className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                          ) : (
                            <UserRound className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                          )}
                          {u.name ?? "—"}
                          {isSelf && <Badge variant="outline" className="text-[10px]">you</Badge>}
                        </span>
                      </td>
                      {/* Long (test) addresses wrap so the action icons stay in view. */}
                      <td className="max-w-[16rem] break-all px-4 py-3 text-muted-foreground">{u.email}</td>
                      <td className="px-4 py-3">
                        <Badge variant={u.role === "ADMIN" ? "default" : u.role === "TEACHER" ? "outline" : "secondary"}>
                          {u.role === "ADMIN" ? "Admin" : u.role === "TEACHER" ? "Teacher" : "User"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={u.nature === "HUMAN" ? "outline" : "secondary"}>{u.nature === "HUMAN" ? "Human" : "Bot"}</Badge>
                      </td>
                      <td className="px-4 py-3 tabular-nums">{u._count.studySets}</td>
                      <td
                        className="whitespace-nowrap px-4 py-3 text-muted-foreground"
                        title={u.lastActiveAt ? new Date(u.lastActiveAt).toLocaleString() : "No activity recorded"}
                      >
                        {lastUsed(u.lastActiveAt)}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{new Date(u.createdAt).toLocaleDateString()}</td>
                      <td className="whitespace-nowrap px-2 py-3">
                        <div className="flex justify-end gap-0.5">
                          {u.role === "USER" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => void promote(u)}
                              disabled={u.nature !== "HUMAN" || update.isPending}
                              title={u.nature !== "HUMAN" ? ADMIN_NEEDS_HUMAN : "Promote to Admin"}
                              aria-label={`Promote ${u.email} to Admin`}
                            >
                              <ShieldPlus className="h-4 w-4" aria-hidden="true" />
                            </Button>
                          )}
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

      <UserEditor state={editor} onClose={() => setEditor(null)} />
      <DeleteDialog user={deleting} onClose={() => setDeleting(null)} />
    </div>
  );
}

function UserEditor({ state, onClose }: { state: EditorState; onClose: () => void }) {
  const editing = state?.mode === "edit" ? state.user : null;
  const create = useCreateUser();
  const update = useUpdateUser();
  // A person filling in this form is inviting a person: new accounts default to Human.
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "USER" as Role, nature: "HUMAN" as Nature });
  const [openedFor, setOpenedFor] = useState<EditorState>(null);

  // Reset the form whenever the dialog opens for a different target.
  if (state !== openedFor) {
    setOpenedFor(state);
    setForm({
      name: editing?.name ?? "",
      email: editing?.email ?? "",
      password: "",
      role: editing?.role ?? "USER",
      nature: editing?.nature ?? "HUMAN",
    });
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
          nature: form.nature,
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
                <option value="TEACHER" disabled={form.nature !== "HUMAN"}>
                  Teacher — can also run PolyLingue classes
                </option>
                <option value="ADMIN" disabled={form.nature !== "HUMAN"}>
                  Admin — can also manage accounts, AI model and courses
                </option>
              </select>
              {form.nature !== "HUMAN" && <p className="text-xs text-muted-foreground">{ADMIN_NEEDS_HUMAN}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="acct-nature">Nature</Label>
              <select
                id="acct-nature"
                value={form.nature}
                onChange={(e) => setForm({ ...form, nature: e.target.value as Nature })}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="HUMAN">Human — a person</option>
                <option value="BOT" disabled={form.role !== "USER"}>
                  Bot — automated tests or AI agents
                </option>
              </select>
              {form.role !== "USER" && (
                <p className="text-xs text-muted-foreground">
                  {form.role === "ADMIN" ? "An Admin" : "A Teacher"} must be Human — set the role to User before making it a Bot.
                </p>
              )}
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
            This permanently deletes the account and everything it owns: its {user?._count.studySets ?? 0} study set(s) with all their
            sources, uploaded files, generated material and study history. It cannot be undone.
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
                .then((r) => {
                  toast.success(`Account deleted, with ${r.studySets} study set(s) and ${r.sources} source(s)`);
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
