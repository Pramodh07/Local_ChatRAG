"use client";

import { memo, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  ChevronDown,
  CreditCard,
  Cpu,
  LogOut,
  Settings,
  User,
  X,
} from "@/modules/shared/components/icons";
import type { AccountInfo, AuthProvider } from "@/modules/auth/types";
import { UserAvatar } from "@/modules/auth/components/user-avatar";
import { NavItem } from "@/modules/shared/components/ui/nav-item";
import { cn } from "@/modules/shared/lib/utils";

type AccountMenuProps = {
  account: AccountInfo;
  authProvider: AuthProvider;
};

const menuItems = [
  { href: "/account", label: "My account", icon: <User size={15} /> },
  { href: "/settings", label: "Settings", icon: <Settings size={15} /> },
  { href: "/models", label: "Models", icon: <Cpu size={15} /> },
  { href: "/usage", label: "Usage", icon: <CreditCard size={15} /> },
];

export const AccountMenu = memo(function AccountMenu({ account, authProvider }: AccountMenuProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [currentAccount, setCurrentAccount] = useState<AccountInfo>(account);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCurrentAccount(account);
  }, [account]);

  useEffect(() => {
    function handleAccountUpdated(event: Event) {
      const customEvent = event as CustomEvent<AccountInfo>;
      if (customEvent.detail && customEvent.detail.id === currentAccount.id) {
        setCurrentAccount(customEvent.detail);
      }
    }
    window.addEventListener("atlas:account-updated", handleAccountUpdated);
    return () => {
      window.removeEventListener("atlas:account-updated", handleAccountUpdated);
    };
  }, [currentAccount.id]);

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  async function signOut() {
    setErrorMessage(null);
    try {
      if (authProvider === "local") {
        const response = await fetch("/api/auth/local/logout", { method: "POST" });
        if (!response.ok) {
          setErrorMessage("Sign-out failed. Try again.");
          return;
        }
        router.refresh();
        return;
      }

      const { createSupabaseBrowserClient } = await import("@/modules/auth/supabase-browser");
      const { error } = await createSupabaseBrowserClient().auth.signOut();
      if (error) {
        setErrorMessage("Sign-out failed. Try again.");
        return;
      }
      router.refresh();
    } catch {
      setErrorMessage("Sign-out failed. Try again.");
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        className={cn(
          "flex items-center gap-2 rounded-xl border px-1.5 py-1 text-left transition-colors duration-150",
          isOpen
            ? "border-line-strong bg-raised"
            : "border-transparent hover:border-line hover:bg-raised",
        )}
        aria-label={`Account menu for ${currentAccount.email}`}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
      >
        <UserAvatar
          avatarUrl={currentAccount.avatarUrl}
          displayName={currentAccount.displayName}
          email={currentAccount.email}
          size="sm"
        />
        <span className="hidden max-w-36 sm:block">
          <span className="block truncate text-[11.5px] font-medium leading-4 text-ink">
            {currentAccount.displayName}
          </span>
          <span className="block truncate text-[10.5px] leading-4 text-muted">
            {currentAccount.email}
          </span>
        </span>
        <ChevronDown
          size={13}
          className={cn("hidden shrink-0 text-faint transition-transform duration-150 sm:block", isOpen && "rotate-180")}
        />
      </button>

      {isOpen && (
        <div
          role="menu"
          aria-label="Account menu"
          className="absolute right-0 top-[calc(100%+8px)] z-50 w-[276px] animate-panel rounded-[var(--radius-container)] border border-line bg-surface-solid p-2 shadow-[var(--shadow-floating)]"
        >
          <div className="mb-1.5 flex items-start justify-between gap-2 rounded-xl px-2 py-2">
            <div className="flex min-w-0 items-center gap-2.5">
              <UserAvatar
                avatarUrl={currentAccount.avatarUrl}
                displayName={currentAccount.displayName}
                email={currentAccount.email}
                size="md"
              />
              <div className="min-w-0">
                <p className="truncate text-[12.5px] font-medium text-ink">{currentAccount.displayName}</p>
                <p className="truncate text-[11px] text-muted">{currentAccount.email}</p>
              </div>
            </div>
            <button
              type="button"
              className="rounded-md p-1 text-faint transition-colors hover:bg-raised hover:text-ink"
              aria-label="Close account menu"
              onClick={() => setIsOpen(false)}
            >
              <X size={13} />
            </button>
          </div>

          <nav className="space-y-0.5 border-t border-line pt-1.5" aria-label="Account pages">
            {menuItems.map((item) => (
              <NavItem
                key={item.href}
                href={item.href}
                icon={item.icon}
                active={pathname === item.href}
                onClick={() => setIsOpen(false)}
              >
                {item.label}
              </NavItem>
            ))}
          </nav>

          {errorMessage && (
            <p className="mt-2 rounded-lg bg-danger/10 px-2.5 py-2 text-[11px] text-danger" role="alert">
              {errorMessage}
            </p>
          )}

          <button
            type="button"
            className="mt-1.5 flex w-full items-center gap-2.5 rounded-[10px] border-t border-line px-3 py-2.5 text-[13px] text-danger transition-colors hover:bg-danger/10"
            onClick={() => void signOut()}
          >
            <LogOut size={15} />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
});
