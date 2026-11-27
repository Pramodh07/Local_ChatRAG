import { AuthScreen } from "@/modules/auth/components/auth-screen";
import { AccountDashboard, type AccountSection } from "@/modules/account/components/account-dashboard";
import { getAuthMode } from "@/modules/auth/auth-mode";
import { getCurrentAccount } from "@/modules/auth/current-account";
import { ConfigurationNotice } from "@/modules/shared/components/configuration-notice";

export async function AccountRoute({ section }: { section: AccountSection }) {
  const authMode = getAuthMode();
  if (authMode === "unconfigured") {
    return <ConfigurationNotice />;
  }

  const session = await getCurrentAccount();
  if (!session) return <AuthScreen authProvider={authMode} />;
  return (
    <AccountDashboard
      section={section}
      account={session.account}
      authProvider={session.authProvider}
    />
  );
}
