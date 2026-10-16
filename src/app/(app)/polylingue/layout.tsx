import type { Metadata, Viewport } from "next";
import { PolyLingueShell } from "@/components/polylingue/shell";

/** PolyLingue can be installed as an app (manifest, icons) and works offline for saved lessons. */
export const metadata: Metadata = {
  manifest: "/polylingue.webmanifest",
  appleWebApp: { capable: true, title: "PolyLingue", statusBarStyle: "default" },
  icons: { apple: "/icons/polylingue-180.png" },
};

export const viewport: Viewport = { themeColor: "#0f766e" };

export default function PolyLingueLayout({ children }: { children: React.ReactNode }) {
  return <PolyLingueShell>{children}</PolyLingueShell>;
}
