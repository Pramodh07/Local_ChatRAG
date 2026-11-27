"use client";

import { useEffect, useRef } from "react";
import { FileText, Quote, X } from "@/modules/shared/components/icons";
import type { Citation } from "@/modules/chat/types";

type SourcePanelProps = {
  citations: Citation[];
  onClose: () => void;
};

function relevanceLabel(score: number) {
  if (score >= 0.8) return "High relevance";
  if (score >= 0.55) return "Moderate relevance";
  return "Related";
}

export function SourcePanel({ citations, onClose }: SourcePanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  const isOpen = citations.length > 0;

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      // Lightweight focus containment: keep keyboard users inside the dialog
      // while it is open, without adding a native <dialog> or changing layout.
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <>
      <div
        className="animate-overlay fixed inset-0 z-30 bg-[color-mix(in_srgb,var(--ink)_24%,transparent)] xl:hidden"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Sources for the latest answer"
        tabIndex={-1}
        className="fixed inset-y-0 right-0 z-40 flex w-[min(360px,88vw)] flex-col border-l border-line bg-surface-solid xl:static xl:z-auto xl:w-[360px] xl:shrink-0 max-md:inset-x-0 max-md:inset-y-auto max-md:bottom-0 max-md:h-[70dvh] max-md:w-full max-md:rounded-t-[var(--radius-container)] max-md:border-l-0 max-md:border-t"
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4">
          <div className="flex items-center gap-2">
            <Quote size={14} className="text-accent-ink" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
              Sources
            </span>
            <span className="rounded-full bg-accent-soft px-1.5 py-0.5 font-mono text-[10px] text-accent-ink">
              {citations.length}
            </span>
          </div>
          <button
            className="rounded-md p-1.5 text-faint transition-colors hover:bg-raised hover:text-ink"
            onClick={onClose}
            aria-label="Close sources"
          >
            <X size={15} />
          </button>
        </div>

        <div className="scroll-slim flex-1 space-y-2.5 overflow-y-auto p-3">
          {citations.map((citation) => (
            <article
              id={`cite-${citation.id}`}
              key={citation.id}
              className="scroll-mt-16 rounded-[var(--radius-card)] border border-line bg-surface-solid p-3.5 transition-colors duration-normal hover:border-accent/40"
            >
              <div className="mb-2.5 flex items-start gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-accent-soft font-mono text-[10.5px] font-semibold text-accent-ink">
                  {citation.id}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <FileText size={12} className="shrink-0 text-faint" />
                    <p className="truncate text-[12px] font-medium leading-5 text-ink">{citation.doc}</p>
                  </div>
                  <p className="mt-0.5 text-[10.5px] text-faint">
                    {citation.page ? `Page ${citation.page}` : "Document excerpt"}
                    {citation.section ? ` · ${citation.section}` : ""}
                  </p>
                </div>
              </div>

              <p className="border-l-2 border-accent/25 pl-2.5 text-[11.5px] leading-[1.65] text-muted">
                {citation.excerpt}
              </p>

              <div className="mt-2.5 flex items-center gap-2">
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-raised">
                  <div
                    className="h-full rounded-full bg-accent/70"
                    style={{ width: `${Math.round(citation.score * 100)}%` }}
                  />
                </div>
                <span className="text-[10px] text-faint">{relevanceLabel(citation.score)}</span>
              </div>
            </article>
          ))}
        </div>

        <p className="shrink-0 border-t border-line px-4 py-3 text-[10.5px] leading-4 text-faint">
          Citations are retrieved passages. Open a source to verify the original context.
        </p>
      </aside>
    </>
  );
}
