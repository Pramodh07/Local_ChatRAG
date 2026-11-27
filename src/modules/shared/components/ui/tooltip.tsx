import { cloneElement, type ReactElement } from "react";

export function Tooltip({
  id,
  content,
  children,
}: {
  id: string;
  content: string;
  children: ReactElement<{ "aria-describedby"?: string }>;
}) {
  return (
    <span className="group relative inline-flex">
      {cloneElement(children, { "aria-describedby": id })}
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-50 hidden -translate-x-1/2 whitespace-nowrap rounded-[var(--radius-control)] border border-line bg-surface-solid px-2 py-1 text-xs text-ink shadow-[var(--shadow-floating)] group-hover:block group-focus-within:block"
      >
        {content}
      </span>
    </span>
  );
}
