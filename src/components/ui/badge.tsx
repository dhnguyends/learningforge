import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "text-foreground",
        citation: "border-transparent bg-citation/15 text-[hsl(var(--citation))] ring-1 ring-inset ring-[hsl(var(--citation)/0.4)]",
        success: "border-transparent bg-[hsl(var(--success))]/15 text-[hsl(var(--success))] ring-1 ring-inset ring-[hsl(var(--success)/0.4)]",
        warning: "border-transparent bg-[hsl(var(--warning))]/15 text-[hsl(var(--warning))] ring-1 ring-inset ring-[hsl(var(--warning)/0.4)]",
        destructive: "border-transparent bg-destructive/15 text-destructive ring-1 ring-inset ring-destructive/40",
        muted: "border-transparent bg-muted text-muted-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
