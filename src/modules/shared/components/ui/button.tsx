import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/modules/shared/lib/utils";

type ButtonVariant = "primary" | "secondary" | "ghost" | "soft" | "danger";
type ButtonSize = "sm" | "md" | "lg" | "icon";

const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-[var(--surface-solid)] hover:brightness-105 active:brightness-95",
  secondary:
    "border border-line bg-[var(--surface-solid)] text-ink hover:border-line-strong hover:bg-raised",
  ghost: "text-muted hover:bg-raised hover:text-ink",
  soft: "bg-accent-soft text-accent-ink hover:brightness-95",
  danger:
    "border border-danger/30 bg-danger/10 text-danger hover:border-danger/50 hover:bg-danger/15",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 px-3 text-sm",
  md: "h-9 gap-2 px-3.5 text-sm",
  lg: "h-10 gap-2 px-4 text-base",
  icon: "h-8 w-8 justify-center",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
  leadingIcon?: ReactNode;
};

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  fullWidth = false,
  leadingIcon,
  className,
  children,
  disabled,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex select-none items-center rounded-[var(--radius-control)] font-medium transition-[background-color,border-color,color,filter] duration-normal disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        fullWidth && "w-full justify-center",
        className,
      )}
      {...props}
    >
      {loading ? (
        <span
          className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent"
          aria-hidden="true"
        />
      ) : (
        leadingIcon
      )}
      {children}
    </button>
  );
}
