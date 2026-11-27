import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { ChevronDown } from "@/modules/shared/components/icons";
import { cn } from "@/modules/shared/lib/utils";

const controlBase =
  "w-full rounded-[var(--radius-control)] border bg-surface-solid text-ink outline-none transition-[border-color,box-shadow] duration-normal placeholder:text-faint focus:border-accent/70 focus:ring-2 focus:ring-accent/20 disabled:opacity-60";

export function Field({
  label,
  htmlFor,
  hint,
  error,
  optional,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  error?: string | null;
  optional?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label
        htmlFor={htmlFor}
        className="flex items-center justify-between text-[12.5px] font-medium text-muted"
      >
        <span>{label}</span>
        {optional && <span className="text-[11px] font-normal text-faint">Optional</span>}
      </label>
      {children}
      {hint && !error && (
        <p className="text-[11.5px] leading-5 text-faint">{hint}</p>
      )}
      {error && (
        <p id={`${htmlFor}-error`} className="text-[11.5px] leading-5 text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function Input({
  invalid,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cn(
        controlBase,
        "h-10 px-3 text-base",
        invalid ? "border-danger focus:border-danger focus:ring-danger/10" : "border-line",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({
  invalid,
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return (
    <textarea
      aria-invalid={invalid || undefined}
      className={cn(
        controlBase,
        "min-h-24 resize-y px-3 py-2.5 text-base leading-6",
        invalid ? "border-danger focus:border-danger focus:ring-danger/10" : "border-line",
        className,
      )}
      {...props}
    />
  );
}

export function Select({
  className,
  children,
  disabled,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={cn("relative", disabled && "opacity-60", className)}>
      <select
        disabled={disabled}
        className={cn(
          controlBase,
          "h-10 appearance-none cursor-pointer rounded-[var(--radius-control)] border-line py-0 pl-4 pr-9 text-base disabled:opacity-100",
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        size={14}
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted"
      />
    </div>
  );
}
