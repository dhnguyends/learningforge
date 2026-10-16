"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { Cloud, Compass, Cpu, GraduationCap, LogOut, MemoryStick, Plus, Settings, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LogoWordmark } from "@/components/shared/brand";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { useActiveAi } from "@/hooks/use-api";

/** Top bar for the authenticated app: brand, Back to Dashboard, Explore, quick-create, account menu. */
export function AppShell({ children, breadcrumb }: { children: React.ReactNode; breadcrumb?: React.ReactNode }) {
  const { data: session } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const user = session?.user;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur">
        <div className="flex h-14 max-w-[1600px] items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/dashboard" aria-label="LearningForge dashboard" className="shrink-0">
              <LogoWordmark />
            </Link>
            {breadcrumb && <div className="hidden min-w-0 items-center gap-2 text-sm text-muted-foreground md:flex">{breadcrumb}</div>}
          </div>
          <div className="flex min-w-0 flex-1 justify-center">
            <ActiveModelBadge isAdmin={user?.role === "ADMIN"} />
          </div>
          <div className="flex items-center gap-1.5">
            {pathname !== "/dashboard" && (
              <Button asChild variant="ghost" size="sm" className="gap-1.5">
                <Link href="/dashboard" aria-label="Back to Dashboard" title="Back to Dashboard">
                  <GraduationCap className="h-4 w-4" aria-hidden="true" /> <span className="hidden lg:inline">Back to Dashboard</span>
                </Link>
              </Button>
            )}
            <Button asChild variant="ghost" size="sm" className="gap-1.5">
              <Link href="/explore" aria-label="Explore the course tree">
                <Compass className="h-3.5 w-3.5" aria-hidden="true" /> <span className="hidden sm:inline">Explore</span>
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link href="/create">
                <Plus className="h-3.5 w-3.5" aria-hidden="true" /> New study set
              </Link>
            </Button>
            <ThemeToggle />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Account menu" className="rounded-full">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                    {(user?.name ?? user?.email ?? "?").slice(0, 1).toUpperCase()}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <p className="truncate text-sm font-medium">{user?.name ?? "Signed in"}</p>
                  <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => router.push("/settings")} className="gap-2">
                  <Settings className="h-4 w-4" aria-hidden="true" /> Settings
                </DropdownMenuItem>
                {session?.user?.role === "ADMIN" && (
                  <DropdownMenuItem onClick={() => router.push("/admin")} className="gap-2">
                    <ShieldCheck className="h-4 w-4" aria-hidden="true" /> Administration
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => void signOut({ callbackUrl: "/" })} className="gap-2">
                  <LogOut className="h-4 w-4" aria-hidden="true" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        {breadcrumb && <div className="flex h-9 items-center gap-2 border-t border-border/50 px-4 text-sm text-muted-foreground md:hidden">{breadcrumb}</div>}
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}

/** The AI model generating content right now; administrators can click through to change it. */
function ActiveModelBadge({ isAdmin }: { isAdmin: boolean }) {
  const { data } = useActiveAi();
  if (!data) return null;
  const Icon = data.cloud ? Cloud : Cpu;
  const gpu = data.gpu;
  const gpuTitle = gpu.available
    ? `GPU for local processing: ${gpu.name}${gpu.memoryMiB ? ` (${Math.round(gpu.memoryMiB / 1024)} GB)` : ""}`
    : "No GPU: transcription, embeddings and local models run on the CPU (slower)";
  const chip = (
    <span
      className="inline-flex max-w-full items-center gap-1.5 truncate rounded-full border border-border bg-muted/50 px-3 py-1 text-xs text-muted-foreground"
      title={`AI model: ${data.model}${data.cloud ? " (cloud)" : " (runs on this computer)"} · ${gpuTitle}`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
      <span className="hidden sm:inline">AI model:</span>
      <span className="truncate font-medium text-foreground">{data.label}</span>
      <span aria-hidden="true" className="text-border">|</span>
      <MemoryStick className={gpu.available ? "h-3.5 w-3.5 shrink-0 text-primary" : "h-3.5 w-3.5 shrink-0 text-amber-600"} aria-hidden="true" />
      <span className={gpu.available ? "truncate font-medium text-foreground" : "truncate font-medium text-amber-700 dark:text-amber-400"}>
        <span className="sr-only">GPU: </span>
        {gpu.label}
      </span>
    </span>
  );
  return isAdmin ? (
    <Link href="/admin" aria-label={`AI model: ${data.label}. Change it in Administration`} className="min-w-0 rounded-full hover:opacity-80">
      {chip}
    </Link>
  ) : (
    chip
  );
}
