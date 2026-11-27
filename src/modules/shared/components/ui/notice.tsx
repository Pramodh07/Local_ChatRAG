import type { ReactNode } from "react";
import { Alert, Check, Info, X } from "@/modules/shared/components/icons";
import { cn } from "@/modules/shared/lib/utils";

type Tone = "info" | "success" | "warning" | "error";

const toneStyles: Record<Tone, string> = {
  info: "border-accent/25 bg-accent-soft/60 text-accent-ink",
  success: "border-ok/25 bg-ok/10 text-ok",
  warning: "border-warn/30 bg-warn/10 text-warn",
  error: "border-danger/30 bg-danger/10 text-danger",
};

const toneIcons: Record<Tone, typeof Info> = {
  info: Info,
  success: Check,
  warning: Alert,
  error: Alert,
};

export function Notice({
  tone = "info",
  children,
  className,
  onDismiss,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  onDismiss?: () => void;
}) {
  const Icon = toneIcons[tone];
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-[12.5px] leading-5",
        toneStyles[tone],
        className,
      )}
      role={tone === "error" ? "alert" : "status"}
    >
      <Icon size={15} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss message"
          className="-mr-1 rounded-md p-0.5 opacity-70 transition-opacity hover:opacity-100"
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}

export function ToastViewport({ children }: { children: ReactNode }) {
  return (
    <div
      className="pointer-events-none fixed inset-x-4 top-16 z-50 flex flex-col items-end gap-2 sm:inset-x-auto sm:right-6 sm:top-20 sm:max-w-sm"
      aria-live="polite"
    >
      {children}
    </div>
  );
}

export function Toast({
  tone = "info",
  children,
  onDismiss,
}: {
  tone?: Tone;
  children: ReactNode;
  onDismiss?: () => void;
}) {
  return (
    <div className="pointer-events-auto w-full animate-fade-up">
      <Notice tone={tone} onDismiss={onDismiss} className="rounded-[var(--radius-card)] bg-surface-solid px-4 py-3 shadow-[var(--shadow-floating)]">
        {children}
      </Notice>
    </div>
  );
}
