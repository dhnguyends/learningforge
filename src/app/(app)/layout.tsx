import { AppShell } from "@/components/shared/app-shell";
import { AccessDeniedNotice } from "@/components/shared/access-denied";

/** Layout for all authenticated pages (middleware guards /dashboard, /create, /study-sets, /settings, /admin). */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      {children}
      <AccessDeniedNotice />
    </AppShell>
  );
}
