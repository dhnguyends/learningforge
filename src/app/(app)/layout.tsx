import { AppShell } from "@/components/shared/app-shell";

/** Layout for all authenticated pages (middleware guards /dashboard, /create, /study-sets, /settings). */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
