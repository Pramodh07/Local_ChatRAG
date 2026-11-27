import { ShieldCheck } from "@/modules/shared/components/icons";
import { UserAvatar } from "@/modules/auth/components/user-avatar";
import { PasswordResetCard } from "@/modules/account/components/password-reset-card";
import { Card } from "@/modules/shared/components/ui/card";
import type { AccountInfo, AuthProvider } from "@/modules/auth/types";

type AccountProfileSectionProps = {
  account: AccountInfo;
  authProvider: AuthProvider;
};

export function AccountProfileSection({ account, authProvider }: AccountProfileSectionProps) {
  return (
    <div className="space-y-5">
      <Card>
        <div className="p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <UserAvatar
              avatarUrl={account.avatarUrl}
              displayName={account.displayName}
              email={account.email}
              size="lg"
              className="ring-2 ring-line"
            />
            <div className="min-w-0">
              <h2 className="truncate text-[17px] font-semibold tracking-[-0.02em]">
                {account.displayName}
              </h2>
              <p className="truncate text-[12.5px] text-muted">{account.email}</p>
            </div>
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-line bg-raised px-2.5 py-1 text-[10.5px] font-medium text-muted sm:ml-auto">
              <ShieldCheck size={12} className="text-ok" />
              {authProvider === "local" ? "Local account" : "Supabase account"}
            </span>
          </div>

          <dl className="mt-5 grid gap-4 border-t border-line pt-5 sm:grid-cols-2">
            <div>
              <dt className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-faint">Name</dt>
              <dd className="mt-1 text-[13px] font-medium text-ink">{account.displayName}</dd>
            </div>
            <div>
              <dt className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-faint">Email</dt>
              <dd className="mt-1 break-all text-[13px] font-medium text-ink">{account.email}</dd>
            </div>
          </dl>
        </div>
      </Card>

      <PasswordResetCard account={account} authProvider={authProvider} />
    </div>
  );
}
