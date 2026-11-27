import type { RefObject } from "react";
import { useState } from "react";
import { Moon, Spinner, Sun, Trash, Upload } from "@/modules/shared/components/icons";
import { UserAvatar } from "@/modules/auth/components/user-avatar";
import type { AccountInfo } from "@/modules/auth/types";
import type { AccountPreferences } from "@/modules/account/types";
import { Button } from "@/modules/shared/components/ui/button";
import { Card, CardHeader } from "@/modules/shared/components/ui/card";
import { ConfirmDialog } from "@/modules/shared/components/ui/dialog";
import { Notice } from "@/modules/shared/components/ui/notice";
import { THEMES } from "@/modules/shared/lib/theme";
import { cn } from "@/modules/shared/lib/utils";
import { ProviderApiKeySection } from "@/modules/account/components/provider-api-key-section";
import { ChatRuntimeSettingsSection } from "@/modules/chat/components/chat-runtime-settings-section";

type AccountSettingsSectionProps = {
  account: AccountInfo;
  preferences: AccountPreferences;
  localMode: boolean;
  loading: boolean;
  saving: boolean;
  avatarLoading: boolean;
  avatarAction: "upload" | "remove" | null;
  avatarError: string | null;
  avatarNotice: string | null;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onSavePreferences: (update: Partial<AccountPreferences>) => void;
  onAvatarUpload: (file: File | undefined) => void;
  onAvatarRemove: () => void;
  onDeleteAllChats: () => void;
};

export function AccountSettingsSection({
  account,
  preferences,
  localMode,
  loading,
  saving,
  avatarLoading,
  avatarAction,
  avatarError,
  avatarNotice,
  fileInputRef,
  onSavePreferences,
  onAvatarUpload,
  onAvatarRemove,
  onDeleteAllChats,
}: AccountSettingsSectionProps) {
  const [confirmDeleteChats, setConfirmDeleteChats] = useState(false);
  return (
    <div className="space-y-5">
      <ProviderApiKeySection account={account} preferences={preferences} localMode={localMode} />
      <ChatRuntimeSettingsSection accountId={account.id} />
      <Card>
        <div className="p-5 sm:p-6">
          <CardHeader
            icon={<Upload size={15} />}
            title="Profile photo"
            description="Upload an image or remove it to use your initials."
          />

          <div className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-center">
            <div className="relative inline-flex shrink-0">
              <UserAvatar
                avatarUrl={account.avatarUrl}
                displayName={account.displayName}
                email={account.email}
                size="xl"
                className="ring-2 ring-line"
              />
              {avatarLoading && (
                <div
                  className="absolute inset-0 flex flex-col items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--ink)_55%,transparent)] text-[var(--surface-solid)]"
                  aria-live="polite"
                  aria-busy="true"
                >
                  <Spinner size={22} className="animate-spin text-white" />
                  <span className="sr-only">
                    {avatarAction === "upload" ? "Uploading image…" : "Removing avatar…"}
                  </span>
                </div>
              )}
            </div>

            <div className="flex min-w-0 flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="hidden"
                  onChange={(event) => onAvatarUpload(event.target.files?.[0])}
                  disabled={avatarLoading}
                />
                <Button
                  variant="primary"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={avatarLoading}
                  loading={avatarAction === "upload"}
                  leadingIcon={<Upload size={14} />}
                >
                  {avatarAction === "upload" ? "Uploading…" : "Upload image"}
                </Button>

                {account.avatarUrl && (
                  <Button
                    variant="secondary"
                    onClick={onAvatarRemove}
                    disabled={avatarLoading}
                    loading={avatarAction === "remove"}
                    leadingIcon={<Trash size={14} />}
                  >
                    {avatarAction === "remove" ? "Removing…" : "Remove"}
                  </Button>
                )}
              </div>

              <p className="text-[11.5px] leading-5 text-muted">
                PNG, JPG, WebP, or GIF · max 2MB
              </p>

              {avatarError && <Notice tone="error">{avatarError}</Notice>}
              {avatarNotice && <Notice tone="success">{avatarNotice}</Notice>}
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <div className="p-5 sm:p-6">
          <CardHeader
            icon={<Sun size={15} />}
            title="Appearance"
            description="Choose the theme used across Atlas."
          />

          {localMode ? (
            <div className="mt-5 grid gap-2.5 sm:grid-cols-2">
              {THEMES.map((theme) => {
                const active = preferences.theme === theme;
                return (
                  <button
                    key={theme}
                    type="button"
                    disabled={loading || saving}
                    aria-pressed={active}
                    onClick={() => onSavePreferences({ theme })}
                    className={cn(
                      "rounded-xl border p-3.5 text-left transition-[border-color,background-color,box-shadow] duration-150 disabled:opacity-60",
                      active
                        ? "border-accent/50 bg-accent-soft"
                        : "border-line bg-[var(--surface-solid)] hover:border-line-strong",
                    )}
                  >
                    <div
                      data-theme={theme}
                      className="relative mb-3 h-16 overflow-hidden rounded-[var(--radius-control)] border border-line bg-canvas p-2"
                    >
                      <span
                        className={cn(
                          "absolute inset-y-2 left-2 w-5 rounded-[var(--radius-control)]",
                          theme === "dark" ? "bg-ink/10" : "bg-surface-solid",
                        )}
                      />
                      <div className="ml-7 space-y-1.5 pt-1">
                        <span
                          className={cn(
                            "block h-2 w-2/3 rounded-full",
                            theme === "dark" ? "bg-ink/25" : "bg-ink/15",
                          )}
                        />
                        <span
                          className={cn(
                            "block h-2 w-full rounded-full",
                            theme === "dark" ? "bg-ink/10" : "bg-ink/10",
                          )}
                        />
                        <span className="mt-2 block h-4 w-12 rounded-md bg-accent/80" />
                      </div>
                    </div>
                    <span className="flex items-center gap-2 text-[12.5px] font-medium capitalize text-ink">
                      {theme === "dark" ? <Moon size={13} /> : <Sun size={13} />}
                      {theme} theme
                      {active && <span className="ml-auto text-[10.5px] font-medium text-accent-ink">Active</span>}
                    </span>
                    <span className="mt-1 block text-[11px] leading-5 text-muted">
                      {theme === "dark"
                        ? "Low-light surfaces with soft contrast."
                        : "Bright, airy surfaces for daytime focus."}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="mt-5 rounded-xl border border-line bg-raised p-4 text-[12.5px] leading-6 text-muted">
              Theme changes are available from the chat header. Account appearance settings are
              limited to local development mode.
            </p>
          )}
        </div>
      </Card>

      {localMode && (
        <Card>
          <div className="p-5 sm:p-6">
            <CardHeader
              icon={<Trash size={15} />}
              title="Danger zone"
              description="Irreversible actions that affect your data."
            />
            <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-4">
              <div>
                <p className="text-[13px] font-medium text-ink">Delete all chats</p>
                <p className="mt-0.5 text-[11.5px] text-muted">
                  Permanently removes all conversations and messages.
                </p>
              </div>
              <Button
                variant="danger"
                leadingIcon={<Trash size={14} />}
                onClick={() => setConfirmDeleteChats(true)}
              >
                Delete all
              </Button>
            </div>
          </div>
        </Card>
      )}

      <ConfirmDialog
        open={confirmDeleteChats}
        onClose={() => setConfirmDeleteChats(false)}
        onConfirm={onDeleteAllChats}
        title="Delete all chats?"
        description="All conversations and messages will be permanently removed. This cannot be undone."
        confirmLabel="Delete all chats"
        destructive
      />
    </div>
  );
}
