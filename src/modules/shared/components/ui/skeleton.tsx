import type { HTMLAttributes } from "react";
import { cn } from "@/modules/shared/lib/utils";

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-[var(--radius-control)] bg-raised", className)}
      {...props}
    />
  );
}
