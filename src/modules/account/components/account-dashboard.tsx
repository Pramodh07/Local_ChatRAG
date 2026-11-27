"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  CreditCard,
  Cpu,
  Logo,
  Moon,
  Settings,
  Sun,
  User,
} from "@/modules/shared/components/icons";
import type { AccountInfo, AuthProvider } from "@/modules/auth/types";
import { AccountMenu } from "@/modules/auth/components/account-menu";
import dynamic from "next/dynamic";
import { DEFAULT_PREFERENCES } from "@/modules/account/defaults";
import type {
  AccountPreferences,
  ModelProvider,
  ProviderModels,
  UsageBucket,
} from "@/modules/account/types";

const AccountProfileSection = dynamic(
  () => import("@/modules/account/components/account-profile-section").then((mod) => mod.AccountProfileSection),
  { ssr: false },
);
const AccountSettingsSection = dynamic(
  () => import("@/modules/account/components/account-settings-section").then((mod) => mod.AccountSettingsSection),
  { ssr: false },
);
const AccountModelsSection = dynamic(
  () => import("@/modules/account/components/account-models-section").then((mod) => mod.AccountModelsSection),
  { ssr: false },
);
const AccountUsageSection = dynamic(
  () => import("@/modules/account/components/account-usage-section").then((mod) => mod.AccountUsageSection),
  { ssr: false },
);
import {
  parsePreferences,
  parseProviders,
  parseUsageBuckets,
  processAvatarFile,
} from "@/modules/account/components/account-dashboard-helpers";
import { Button } from "@/modules/shared/components/ui/button";
import { Notice } from "@/modules/shared/components/ui/notice";
import { NavItem } from "@/modules/shared/components/ui/nav-item";
import { isRecord } from "@/modules/shared/lib/guards";
import { errorMessageFromPayload } from "@/modules/shared/lib/http";
import { applyTheme, getDocumentTheme, type Theme } from "@/modules/shared/lib/theme";

export type AccountSection = "account" | "settings" | "models" | "usage";

const sections: { id: AccountSection; label: string; href: string; icon: typeof User }[] = [
  { id: "account", label: "My account", href: "/account", icon: User },
  { id: "settings", label: "Settings", href: "/settings", icon: Settings },
  { id: "models", label: "Models", href: "/models", icon: Cpu },
  { id: "usage", label: "Usage", href: "/usage", icon: CreditCard },
];

const titles: Record<AccountSection, { title: string; description: string }> = {
  account: { title: "My account", description: "Manage your Atlas profile and account security." },
  settings: { title: "Settings", description: "Personalize how Atlas looks and behaves." },
  models: { title: "Models", description: "Choose the model that powers local development chat." },
  usage: { title: "Model usage", description: "Requests, tokens, and estimated provider costs." },
};

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const ALLOWED_AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export function AccountDashboard({
  section,
  account: initialAccount,
  authProvider,
}: {
  section: AccountSection;
  account: AccountInfo;
  authProvider: AuthProvider;
}) {
  const router = useRouter();
  const localMode = authProvider === "local";
  const [account, setAccount] = useState<AccountInfo>(initialAccount);
  const [preferences, setPreferences] = useState<AccountPreferences>({ ...DEFAULT_PREFERENCES });
  const [theme, setTheme] = useState<Theme>("light");
  const [providers, setProviders] = useState<ProviderModels[]>([]);
  const [usage, setUsage] = useState<UsageBucket[]>([]);
  const [loading, setLoading] = useState(section !== "account" && localMode);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [avatarLoading, setAvatarLoading] = useState(false);
  const [avatarAction, setAvatarAction] = useState<"upload" | "remove" | null>(null);
  const [avatarNotice, setAvatarNotice] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedProvider = providers.find((provider) => provider.id === preferences.provider);
  const selectedModel = selectedProvider?.models.find((model) => model.id === preferences.model);
  const title = titles[section];

  useEffect(() => {
    setAccount(initialAccount);
  }, [initialAccount]);

  useEffect(() => {
    function handleAccountUpdated(event: Event) {
      const customEvent = event as CustomEvent<AccountInfo>;
      if (customEvent.detail && customEvent.detail.id === account.id) {
        setAccount(customEvent.detail);
      }
    }
    window.addEventListener("atlas:account-updated", handleAccountUpdated);
    return () => {
      window.removeEventListener("atlas:account-updated", handleAccountUpdated);
    };
  }, [account.id]);

  useEffect(() => {
    const currentTheme = getDocumentTheme();
    if (currentTheme) setTheme(currentTheme);
  }, []);

  useEffect(() => {
    if (!localMode || section === "account") return;
    let cancelled = false;

    async function loadPageData() {
      setLoading(true);
      setError(null);
      try {
        const [preferencesResponse, detailResponse] = await Promise.all([
          fetch("/api/account/preferences", { cache: "no-store" }),
          section === "models"
            ? fetch("/api/account/models", { cache: "no-store" })
            : section === "usage"
              ? fetch("/api/account/usage", { cache: "no-store" })
              : Promise.resolve(null),
        ]);
        const preferencesPayload: unknown = await preferencesResponse.json();
        if (!preferencesResponse.ok) {
          throw new Error(errorMessageFromPayload(preferencesPayload, "Preferences could not be loaded."));
        }
        if (!isRecord(preferencesPayload)) throw new Error("The preferences response was invalid.");
        const loadedPreferences = parsePreferences(preferencesPayload.preferences);
        if (!loadedPreferences) throw new Error("The saved preferences were invalid.");
        if (cancelled) return;
        setPreferences(loadedPreferences);
        if (section === "settings") {
          setTheme(loadedPreferences.theme);
          applyTheme(loadedPreferences.theme);
        }

        if (section === "models") {
          if (!detailResponse) throw new Error("Model options could not be loaded.");
          const modelsPayload: unknown = await detailResponse.json();
          if (!detailResponse.ok) {
            throw new Error(errorMessageFromPayload(modelsPayload, "Model options could not be loaded."));
          }
          if (!isRecord(modelsPayload)) throw new Error("The model options response was invalid.");
          const loadedProviders = parseProviders(modelsPayload.providers);
          if (!loadedProviders) throw new Error("The model options response was invalid.");
          setProviders(loadedProviders);
        }

        if (section === "usage") {
          if (!detailResponse) throw new Error("Usage data could not be loaded.");
          const usagePayload: unknown = await detailResponse.json();
          if (!detailResponse.ok) {
            throw new Error(errorMessageFromPayload(usagePayload, "Usage data could not be loaded."));
          }
          if (!isRecord(usagePayload)) throw new Error("The usage response was invalid.");
          const loadedUsage = parseUsageBuckets(usagePayload.usage);
          if (!loadedUsage) throw new Error("The usage data was invalid.");
          setUsage(loadedUsage);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Account data could not be loaded.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadPageData();
    return () => {
      cancelled = true;
    };
  }, [localMode, section]);

  async function savePreferences(update: Partial<AccountPreferences>) {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/account/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        throw new Error(errorMessageFromPayload(payload, "Preferences could not be saved."));
      }
      if (!isRecord(payload)) throw new Error("The saved preferences response was invalid.");
      const saved = parsePreferences(payload.preferences);
      if (!saved) throw new Error("The saved preferences response was invalid.");

      if ("provider" in update || "model" in update) setPreferences(saved);
      else if (update.theme) setPreferences((current) => ({ ...current, theme: saved.theme }));

      if (update.theme) {
        setTheme(update.theme);
        applyTheme(update.theme);
      }
      setNotice("Saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Preferences could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  function chooseProvider(provider: ModelProvider) {
    const models = providers.find((item) => item.id === provider)?.models ?? [];
    setPreferences((current) => ({ ...current, provider, model: models[0]?.id ?? "" }));
    setNotice(null);
  }

  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    applyTheme(nextTheme);
    if (localMode) void savePreferences({ theme: nextTheme });
  }

  async function deleteAllChats() {
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/conversations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerId: account.id, conversations: [] }),
      });
      const text = await response.text();
      let payload: unknown = null;
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = null;
        }
      }
      if (!response.ok) {
        throw new Error(errorMessageFromPayload(payload, "Chats could not be deleted."));
      }
      setNotice("All chats deleted.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chats could not be deleted.");
    }
  }

  async function handleAvatarUpload(file: File | undefined) {
    if (!file) return;

    if (!ALLOWED_AVATAR_TYPES.includes(file.type)) {
      setAvatarError("Please select a valid image file (PNG, JPG, WebP, or GIF).");
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setAvatarError("Image file size must be under 2MB.");
      return;
    }

    setAvatarLoading(true);
    setAvatarAction("upload");
    setAvatarError(null);
    setAvatarNotice(null);

    try {
      const dataUrl = await processAvatarFile(file);
      const response = await fetch("/api/account/avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarUrl: dataUrl }),
      });

      const payload: unknown = await response.json();
      if (!response.ok) {
        throw new Error(errorMessageFromPayload(payload, "Failed to upload avatar."));
      }
      if (!isRecord(payload) || typeof payload.avatarUrl !== "string") {
        throw new Error("Invalid response received from server.");
      }

      const updatedAccount: AccountInfo = { ...account, avatarUrl: payload.avatarUrl };
      setAccount(updatedAccount);
      window.dispatchEvent(new CustomEvent("atlas:account-updated", { detail: updatedAccount }));
      router.refresh();
      setAvatarNotice("Avatar updated successfully.");
    } catch (uploadError) {
      setAvatarError(uploadError instanceof Error ? uploadError.message : "Failed to upload avatar.");
    } finally {
      setAvatarLoading(false);
      setAvatarAction(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleAvatarRemove() {
    if (!account.avatarUrl) return;

    setAvatarLoading(true);
    setAvatarAction("remove");
    setAvatarError(null);
    setAvatarNotice(null);

    try {
      const response = await fetch("/api/account/avatar", { method: "DELETE" });
      const payload: unknown = await response.json();
      if (!response.ok) {
        throw new Error(errorMessageFromPayload(payload, "Failed to remove avatar."));
      }

      const updatedAccount: AccountInfo = { ...account, avatarUrl: null };
      setAccount(updatedAccount);
      window.dispatchEvent(new CustomEvent("atlas:account-updated", { detail: updatedAccount }));
      router.refresh();
      setAvatarNotice("Avatar removed.");
    } catch (removeError) {
      setAvatarError(removeError instanceof Error ? removeError.message : "Failed to remove avatar.");
    } finally {
      setAvatarLoading(false);
      setAvatarAction(null);
    }
  }

  return (
    <main className="min-h-dvh text-ink">
      <header className="sticky top-0 z-30 border-b border-line bg-canvas">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-5 sm:px-8">
          <Link
            href="/"
            className="flex items-center gap-2.5 text-[13.5px] font-semibold tracking-[-0.02em] transition-opacity hover:opacity-80"
          >
            <Logo className="h-8 w-8" />
            <span>Atlas</span>
          </Link>
          <div className="flex items-center gap-1.5">
            <Link
              href="/"
              className="hidden items-center gap-1.5 rounded-[10px] px-2.5 py-2 text-[12px] text-muted transition-colors hover:bg-raised hover:text-ink sm:inline-flex"
            >
              Back to chat <ArrowUpRight size={13} />
            </Link>
            <Button
              variant="ghost"
              size="icon"
              className="text-muted hover:text-ink"
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
              title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
              onClick={toggleTheme}
            >
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </Button>
            <div className="ml-0.5">
              <AccountMenu account={account} authProvider={authProvider} />
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-7 px-5 py-8 sm:px-8 lg:grid-cols-[232px_minmax(0,1fr)] lg:gap-10 lg:py-10">
        <aside className="min-w-0">
          <div className="rounded-[var(--radius-card)] border border-line bg-surface-solid p-2">
            <nav className="grid grid-cols-2 gap-1 lg:flex lg:flex-col" aria-label="Account pages">
              {sections.map(({ id, label, href, icon: Icon }) => (
                <NavItem
                  key={id}
                  href={href}
                  icon={<Icon size={15} />}
                  active={section === id}
                  className="min-w-0"
                >
                  {label}
                </NavItem>
              ))}
            </nav>
          </div>
        </aside>

        <section className="min-w-0">
          <div className="mb-6">
            <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.03em]">{title.title}</h1>
            <p className="mt-1.5 text-[13px] leading-6 text-muted">{title.description}</p>
          </div>

          {(error || notice) && (
            <div className="mb-5 space-y-2">
              {error && (
                <Notice tone="error" onDismiss={() => setError(null)}>
                  {error}
                </Notice>
              )}
              {notice && (
                <Notice tone="success" onDismiss={() => setNotice(null)}>
                  {notice}
                </Notice>
              )}
            </div>
          )}

          {section === "account" && (
            <AccountProfileSection account={account} authProvider={authProvider} />
          )}
          {section === "settings" && (
            <AccountSettingsSection
              account={account}
              preferences={preferences}
              localMode={localMode}
              loading={loading}
              saving={saving}
              avatarLoading={avatarLoading}
              avatarAction={avatarAction}
              avatarError={avatarError}
              avatarNotice={avatarNotice}
              fileInputRef={fileInputRef}
              onSavePreferences={(update) => void savePreferences(update)}
              onAvatarUpload={(file) => void handleAvatarUpload(file)}
              onAvatarRemove={() => void handleAvatarRemove()}
              onDeleteAllChats={() => void deleteAllChats()}
            />
          )}
          {section === "models" && (
            <AccountModelsSection
              providers={providers}
              preferences={preferences}
              selectedProvider={selectedProvider}
              selectedModel={selectedModel}
              localMode={localMode}
              loading={loading}
              saving={saving}
              onChooseProvider={chooseProvider}
              onChangeModel={(model) =>
                setPreferences((current) => ({ ...current, model }))
              }
              onSaveModel={() =>
                void savePreferences({ provider: preferences.provider, model: preferences.model })
              }
            />
          )}
          {section === "usage" && (
            <AccountUsageSection usage={usage} localMode={localMode} loading={loading} />
          )}
        </section>
      </div>
    </main>
  );
}
