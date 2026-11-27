import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { Moon, PanelLeft, PanelRight, Sun } from "@/modules/shared/components/icons";
import { Button } from "@/modules/shared/components/ui/button";
import type { Theme } from "@/modules/shared/lib/theme";

type ChatHeaderProps = {
  title: string;
  sidebarOpen: boolean;
  theme: Theme;
  accountControl: ReactNode;
  hasSources: boolean;
  sourcesOpen: boolean;
  onRenameTitle: (title: string) => void;
  onOpenSidebar: () => void;
  onToggleSources: () => void;
  onToggleTheme: () => void;
};

export function ChatHeader({
  title,
  sidebarOpen,
  theme,
  accountControl,
  hasSources,
  sourcesOpen,
  onRenameTitle,
  onOpenSidebar,
  onToggleSources,
  onToggleTheme,
}: ChatHeaderProps) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title);
  const cancelTitleEdit = useRef(false);

  useEffect(() => setDraftTitle(title), [title]);

  function saveTitle() {
    const nextTitle = draftTitle.trim().slice(0, 100);
    if (nextTitle) onRenameTitle(nextTitle);
    else setDraftTitle(title);
    setEditingTitle(false);
  }

  return (
    <header className="z-20 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line bg-canvas px-3 sm:px-4">
      <div className="flex min-w-0 items-center gap-2">
        {!sidebarOpen && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenSidebar}
            aria-label="Open sidebar"
            className="text-muted hover:text-ink"
          >
            <PanelLeft size={16} />
          </Button>
        )}
        {editingTitle ? (
          <input
            autoFocus
            value={draftTitle}
            maxLength={100}
            aria-label="Edit conversation title"
            className="min-w-0 max-w-64 rounded-[var(--radius-control)] border border-accent bg-surface-solid px-2 py-1 text-sm text-ink outline-none focus:ring-2 focus:ring-accent/20"
            onChange={(event) => setDraftTitle(event.target.value)}
            onBlur={() => {
              if (cancelTitleEdit.current) {
                cancelTitleEdit.current = false;
                return;
              }
              saveTitle();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                cancelTitleEdit.current = true;
                setDraftTitle(title);
                setEditingTitle(false);
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="truncate text-left text-sm font-medium tracking-[-0.01em] text-ink hover:text-accent-ink"
            aria-label={`Edit conversation title: ${title}`}
            onClick={() => setEditingTitle(true)}
          >
            {title}
          </button>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        {hasSources && (
          <Button
            variant="ghost"
            size="icon"
            className={sourcesOpen ? "text-accent-ink" : "text-muted hover:text-ink"}
            aria-label={sourcesOpen ? "Hide sources panel" : "Show sources panel"}
            aria-pressed={sourcesOpen}
            onClick={onToggleSources}
          >
            <PanelRight size={16} />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="text-muted hover:text-ink"
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          onClick={onToggleTheme}
        >
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </Button>
        <div className="ml-1">{accountControl}</div>
      </div>
    </header>
  );
}
