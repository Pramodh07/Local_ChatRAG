import type { HTMLAttributes } from "react";
import { cn } from "@/modules/shared/lib/utils";

type BadgeTone = "neutral" | "success" | "warning" | "danger";

const toneClasses: Record<BadgeTone, string> = {
  neutral: "border-line bg-raised text-muted",
  success: "border-ok/25 bg-ok/10 text-ok",
  warning: "border-warn/30 bg-warn/10 text-warn",
  danger: "border-danger/30 bg-danger/10 text-danger",
};

export function Badge({
  tone = "neutral",
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn("inline-flex min-h-6 items-center rounded-full border px-2 text-xs font-medium", toneClasses[tone], className)}
      {...props}
    />
  );
}
