"use client";

import { cn } from "@/modules/shared/lib/utils";

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  const activeIndex = options.findIndex((option) => option.value === value);

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn("relative grid gap-1 rounded-xl border border-line bg-raised p-1", className)}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-1 left-1 top-1 rounded-lg bg-[var(--surface-solid)] shadow-[var(--shadow-soft)] transition-transform duration-200"
        style={{
          width: `calc((100% - 0.5rem) / ${options.length})`,
          transform: `translateX(calc(${activeIndex * 100}% + ${activeIndex * 0.25}rem))`,
        }}
      />
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "relative z-10 h-9 rounded-lg text-[12.5px] font-medium transition-colors duration-150",
              active
                ? "text-ink"
                : "text-muted hover:text-ink",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
