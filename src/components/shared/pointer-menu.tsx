"use client";

import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface MenuPoint {
  x: number;
  y: number;
}

/**
 * Where a context menu opens: at the pointer for a right click, or under the
 * element when it comes from the keyboard (Shift+F10 / the context-menu key,
 * whose contextmenu event has no pointer position).
 */
export function menuPoint(e: { clientX?: number; clientY?: number; currentTarget: EventTarget }): MenuPoint {
  if (e.clientX || e.clientY) return { x: e.clientX ?? 0, y: e.clientY ?? 0 };
  const r = (e.currentTarget as Element).getBoundingClientRect();
  return { x: r.left, y: r.bottom };
}

/** True for the keys that open a context menu from the keyboard. */
export const isMenuKey = (e: { key: string; shiftKey: boolean }) => e.key === "ContextMenu" || (e.shiftKey && e.key === "F10");

/**
 * A context menu opened at a point of the viewport (Radix dropdown anchored
 * to an invisible element there): arrow keys move, Enter chooses, Esc and an
 * outside click close it.
 */
export function PointerMenu({
  at,
  onClose,
  onCloseAutoFocus,
  className,
  children,
}: {
  at: MenuPoint | null;
  onClose: () => void;
  /** Where focus goes when it closes (call e.preventDefault() to handle it yourself). */
  onCloseAutoFocus?: (e: Event) => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenu open={at !== null} onOpenChange={(open) => !open && onClose()}>
      <DropdownMenuTrigger asChild>
        <span aria-hidden="true" tabIndex={-1} className="pointer-events-none fixed h-0 w-0" style={{ left: at?.x ?? 0, top: at?.y ?? 0 }} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className={cn("w-64", className)} onCloseAutoFocus={onCloseAutoFocus}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
