"use client";

import { Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * "Access denied" pop-up, shown when a standard account was turned away from
 * an admin-only page (the guard redirects with ?denied=admin). Closing it
 * removes the parameter so a reload does not show it again.
 */
export function AccessDeniedNotice() {
  return (
    <Suspense fallback={null}>
      <Notice />
    </Suspense>
  );
}

function Notice() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const open = params.get("denied") === "admin";

  const close = () => {
    const rest = new URLSearchParams(params);
    rest.delete("denied");
    const query = rest.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent role="alertdialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-destructive" aria-hidden="true" /> Access denied
          </DialogTitle>
          <DialogDescription>
            The administration page is only available to Admin accounts. Ask an administrator if you need access.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={close} autoFocus>
            OK
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
