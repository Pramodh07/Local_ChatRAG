"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  Check,
  ChevronDown,
  Database,
  Logo,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  Trash,
  X,
} from "@/modules/shared/components/icons";
import Link from "next/link";
import type { Conversation } from "@/modules/chat/types";
import { Button } from "@/modules/shared/components/ui/button";
import { ConfirmDialog } from "@/modules/shared/components/ui/dialog";
import { cn, formatCount } from "@/modules/shared/lib/utils";

type DateFilter = "all" | "today" | "yesterday" | "last-7-days" | "archived";

const dateFilters: Array<{ value: DateFilter; label: string }> = [
  { value: "all", label: "All chats" },
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last-7-days", label: "Last 7 days" },
  { value: "archived", label: "Archived" },
];

type ChatSidebarProps = {
  conversations: Conversation[];
  activeConversationId: string;
  totalTokens: number;
  onNewConversation: () => void;
  onSelectConversation: (id: string) => void;
  onToggleArchiveConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
  onClose: () => void;
};

function localDateOrdinal(timestamp: number) {
  const date = new Date(timestamp);
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
}

const shortDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "long",
  day: "numeric",
});
const shortDateWithYearFormatter = new Intl.DateTimeFormat(undefined, {
  month: "long",
  day: "numeric",
  year: "numeric",
});

function getDateLabel(timestamp: number, daysAgo: number) {
  if (daysAgo === 0) return "Today";
  if (daysAgo === 1) return "Yesterday";
  if (daysAgo <= 7) return "Previous 7 days";
  if (daysAgo < 0) return "Upcoming";
  const date = new Date(timestamp);
  const formatter =
    date.getFullYear() !== new Date().getFullYear()
      ? shortDateWithYearFormatter
      : shortDateFormatter;
  return formatter.format(date);
}

export const ChatSidebar = memo(function ChatSidebar({
  conversations,
  activeConversationId,
  totalTokens,
  onNewConversation,
  onSelectConversation,
  onToggleArchiveConversation,
  onDeleteConversation,
  onClose,
}: ChatSidebarProps) {
  const [searchText, setSearchText] = useState("");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Conversation | null>(null);
  const navRef = useRef<HTMLElement>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const filterTriggerRef = useRef<HTMLButtonElement>(null);
  const filterOptionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openMenuId && !isFilterOpen) return;

    function closeMenu(event: PointerEvent) {
      if (!navRef.current?.contains(event.target as Node)) setOpenMenuId(null);
      if (!filterRef.current?.contains(event.target as Node)) setIsFilterOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenMenuId(null);
        setIsFilterOpen(false);
        filterTriggerRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", closeMenu);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isFilterOpen, openMenuId]);

  useEffect(() => {
    if (!isFilterOpen) return;
    filterOptionsRef.current
      ?.querySelector<HTMLButtonElement>('[aria-selected="true"]')
      ?.focus();
  }, [isFilterOpen]);

  const groups = useMemo(() => {
    const todayOrdinal = localDateOrdinal(Date.now());
    const search = searchText.trim().normalize("NFKC").toLocaleLowerCase();
    const visible = conversations.filter((conversation) => {
      const isArchived = conversation.archivedAt !== undefined;
      if (dateFilter === "archived" ? !isArchived : isArchived) return false;
      if (search && !conversation.title.normalize("NFKC").toLocaleLowerCase().includes(search)) return false;

      const daysAgo = todayOrdinal - localDateOrdinal(conversation.updatedAt);
      if (dateFilter === "today" && daysAgo !== 0) return false;
      if (dateFilter === "yesterday" && daysAgo !== 1) return false;
      if (dateFilter === "last-7-days" && (daysAgo < 0 || daysAgo >= 7)) return false;
      return true;
    }).sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));

    const grouped = new Map<string, { label: string; updatedAt: number; items: Conversation[] }>();
    for (const conversation of visible) {
      const date = localDateOrdinal(conversation.updatedAt);
      const label = getDateLabel(conversation.updatedAt, todayOrdinal - date);
      const group = grouped.get(label) ?? { label, updatedAt: conversation.updatedAt, items: [] };
      group.items.push(conversation);
      group.updatedAt = Math.max(group.updatedAt, conversation.updatedAt);
      grouped.set(label, group);
    }

    return [...grouped.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }, [conversations, dateFilter, searchText]);

  const numberById = useMemo(() => {
    const numbers = new Map<string, number>();
    const archived = dateFilter === "archived";
    const conversationsByDate = new Map<number, Conversation[]>();
    for (const conversation of conversations) {
      if ((conversation.archivedAt !== undefined) !== archived) continue;
      const date = localDateOrdinal(conversation.updatedAt);
      const items = conversationsByDate.get(date) ?? [];
      items.push(conversation);
      conversationsByDate.set(date, items);
    }

    for (const items of conversationsByDate.values()) {
      items
        .sort((a, b) => a.updatedAt - b.updatedAt || a.id.localeCompare(b.id))
        .forEach((conversation, index) => numbers.set(conversation.id, index + 1));
    }
    return numbers;
  }, [conversations, dateFilter]);

  const usagePercent = Math.min((totalTokens / 50_000) * 100, 100);

  return (
    <>
      <aside className="flex h-full w-full flex-col border-r border-line bg-canvas-deep lg:w-[260px]">
        <div className="flex h-14 shrink-0 items-center justify-between px-4">
          <div className="flex items-center gap-2.5">
            <Logo className="h-7 w-7" />
            <span className="text-[13.5px] font-semibold tracking-[-0.02em]">Atlas</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close sidebar"
            onClick={onClose}
            className="text-faint hover:text-ink"
          >
            <X size={15} />
          </Button>
        </div>

        <div className="space-y-2 px-3 pb-3">
          <Button
            variant="primary"
            size="md"
            fullWidth
            leadingIcon={<Plus size={15} />}
            onClick={onNewConversation}
            className="justify-center"
          >
            New chat
          </Button>

          <div className="relative flex h-9 items-center rounded-[10px] border border-line bg-[var(--surface-solid)] px-2.5 text-muted transition-[border-color,box-shadow] focus-within:border-accent/50 focus-within:ring-4 focus-within:ring-accent/10">
            <Search size={14} className="pointer-events-none absolute left-2.5" />
            <input
              type="text"
              role="searchbox"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setSearchText("");
                if (event.key === "Enter") {
                  event.preventDefault();
                  const firstMatch = groups[0]?.items[0];
                  if (firstMatch) onSelectConversation(firstMatch.id);
                }
              }}
              placeholder="Search chats"
              aria-label="Search chats by name"
              autoComplete="off"
              className="h-full w-full min-w-0 bg-transparent px-6 text-[12.5px] text-ink outline-none placeholder:text-faint"
            />
            {searchText && (
              <button
                type="button"
                onClick={() => setSearchText("")}
                aria-label="Clear chat search"
                className="absolute right-1.5 rounded-full p-1 text-faint hover:bg-raised hover:text-ink"
              >
                <X size={12} />
              </button>
            )}
          </div>

          <div ref={filterRef} className="relative">
            <button
              ref={filterTriggerRef}
              type="button"
              aria-label="Filter chats by date"
              aria-haspopup="listbox"
              aria-expanded={isFilterOpen}
              onClick={() => setIsFilterOpen((open) => !open)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setIsFilterOpen(true);
                }
              }}
              className="relative flex h-9 w-full items-center justify-center rounded-[10px] border border-line bg-[var(--surface-solid)] px-3 text-center text-[12px] text-muted transition-colors hover:border-line-strong hover:text-ink"
            >
              <span>{dateFilters.find((filter) => filter.value === dateFilter)?.label}</span>
              <ChevronDown
                size={14}
                className={cn("absolute right-3 transition-transform duration-150", isFilterOpen && "rotate-180")}
              />
            </button>
            {isFilterOpen && (
              <div
                ref={filterOptionsRef}
                role="listbox"
                aria-label="Date filter options"
                className="absolute inset-x-0 top-[calc(100%+6px)] z-30 rounded-[var(--radius-card)] border border-line bg-surface-solid p-1 shadow-[var(--shadow-floating)]"
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setIsFilterOpen(false);
                    filterTriggerRef.current?.focus();
                    return;
                  }

                  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
                  event.preventDefault();
                  const options = Array.from(
                    filterOptionsRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [],
                  );
                  const currentIndex = options.indexOf(document.activeElement as HTMLButtonElement);
                  const step = event.key === "ArrowDown" ? 1 : -1;
                  const nextIndex = (currentIndex + step + options.length) % options.length;
                  options[nextIndex]?.focus();
                }}
              >
                {dateFilters.map((filter) => (
                  <button
                    key={filter.value}
                    type="button"
                    role="option"
                    aria-selected={dateFilter === filter.value}
                    onClick={() => {
                      setDateFilter(filter.value);
                      setIsFilterOpen(false);
                      filterTriggerRef.current?.focus();
                    }}
                    className={cn(
                      "relative flex w-full items-center justify-center rounded-lg px-2.5 py-2 text-center text-[12px] transition-colors hover:bg-raised",
                      dateFilter === filter.value ? "text-ink" : "text-muted",
                    )}
                  >
                    {filter.label}
                    {dateFilter === filter.value && <Check size={13} className="absolute right-2 text-accent-ink" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <nav ref={navRef} className="scroll-slim flex-1 px-3 pb-3" aria-label="Conversations">
          {groups.length ? groups.map((group) => (
            <div className="mb-4" key={group.label}>
              <div className="flex items-center justify-between px-2 pb-1.5 text-[10.5px] font-medium uppercase tracking-[0.08em] text-faint">
                <span>{group.label}</span>
                <span className="tabular-nums">{group.items.length}</span>
              </div>
              {group.items.map((conversation) => {
                const isActive = conversation.id === activeConversationId;
                return (
                  <div
                    key={conversation.id}
                    className={cn(
                      "group relative mb-0.5 flex h-9 items-center rounded-[10px] transition-colors",
                      isActive ? "bg-accent-soft" : "hover:bg-raised",
                    )}
                  >
                    <button
                      onClick={() => onSelectConversation(conversation.id)}
                      aria-current={isActive ? "page" : undefined}
                      className={cn(
                        "flex min-w-0 flex-1 items-center justify-between gap-2 rounded-[10px] py-2 pl-2.5 text-left text-[12.5px] transition-colors",
                        isActive ? "font-medium text-accent-ink" : "text-muted hover:text-ink",
                      )}
                    >
                      <span className="truncate">{conversation.title}</span>
                      <span className="shrink-0 pr-1 font-mono text-[10px] tabular-nums text-faint">
                        #{numberById.get(conversation.id)}
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Options for ${conversation.title}`}
                      aria-haspopup="menu"
                      aria-expanded={openMenuId === conversation.id}
                      onClick={() => setOpenMenuId((openId) => openId === conversation.id ? null : conversation.id)}
                      className={cn(
                        "mr-1 rounded-md p-1 text-muted transition-colors hover:bg-[var(--surface-solid)] hover:text-ink",
                        openMenuId === conversation.id
                          ? "bg-[var(--surface-solid)] text-ink"
                          : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                      )}
                    >
                      <MoreHorizontal size={15} />
                    </button>
                    {openMenuId === conversation.id && (
                      <div
                        role="menu"
                        aria-label={`Options for ${conversation.title}`}
                        className="absolute right-1 top-9 z-30 min-w-40 rounded-[var(--radius-card)] border border-line bg-surface-solid p-1 shadow-[var(--shadow-floating)]"
                      >
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            onToggleArchiveConversation(conversation.id);
                            setOpenMenuId(null);
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] text-muted transition-colors hover:bg-raised hover:text-ink"
                        >
                          <Archive size={14} />
                          {conversation.archivedAt === undefined ? "Archive chat" : "Unarchive chat"}
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setPendingDelete(conversation);
                            setOpenMenuId(null);
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] text-danger transition-colors hover:bg-danger/10"
                        >
                          <Trash size={14} />
                          Delete chat
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )) : (
            <div className="px-2 py-8 text-center" role="status">
              <p className="text-[12px] leading-5 text-muted">
                {searchText.trim()
                  ? "No chats match your search."
                  : dateFilter === "archived"
                    ? "No archived chats yet."
                    : "No chats for this date."}
              </p>
              {searchText.trim() && (
                <button
                  type="button"
                  onClick={() => setSearchText("")}
                  className="mt-2 text-[11.5px] font-medium text-accent-ink hover:opacity-80"
                >
                  Clear search
                </button>
              )}
            </div>
          )}
        </nav>

        <div className="shrink-0 border-t border-line p-3">
          <nav className="mb-3 space-y-0.5" aria-label="Workspace">
            <Link
              href="/knowledge"
              onClick={onClose}
              className="flex min-h-9 items-center gap-2.5 rounded-[var(--radius-control)] px-3 text-sm text-muted transition-colors duration-normal hover:bg-raised hover:text-ink"
            >
              <Database size={15} />
              Knowledge Base
            </Link>
            <Link
              href="/settings"
              onClick={onClose}
              className="flex min-h-9 items-center gap-2.5 rounded-[var(--radius-control)] px-3 text-sm text-muted transition-colors duration-normal hover:bg-raised hover:text-ink"
            >
              <Settings size={15} />
              Settings
            </Link>
          </nav>
          <div className="mb-2 flex items-center justify-between text-[11px] text-muted">
            <span>Conversation usage</span>
            <span className="font-mono tabular-nums">{formatCount(totalTokens)} / 50k</span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-raised">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-300"
              style={{ width: `${usagePercent}%` }}
            />
          </div>
          <p className="mt-2 text-[10.5px] text-faint">Tokens used in this conversation.</p>
        </div>
      </aside>

      <ConfirmDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) onDeleteConversation(pendingDelete.id);
        }}
        title="Delete this chat?"
        description={
          pendingDelete
            ? `"${pendingDelete.title}" and its messages will be permanently removed. This cannot be undone.`
            : undefined
        }
        confirmLabel="Delete chat"
        destructive
      />
    </>
  );
});
