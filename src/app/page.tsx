import { AuthScreen } from "@/modules/auth/components/auth-screen";
import { ChatWorkspace } from "@/modules/chat/chat-workspace";
import { getAuthMode } from "@/modules/auth/auth-mode";
import { getCurrentAccount } from "@/modules/auth/current-account";
import { ConfigurationNotice } from "@/modules/shared/components/configuration-notice";

export const dynamic = "force-dynamic";

export default async function Page() {
  const authMode = getAuthMode();
  if (authMode === "unconfigured") {
    return <ConfigurationNotice />;
  }

  const session = await getCurrentAccount();
  if (!session) return <AuthScreen authProvider={authMode} />;
  return <ChatWorkspace account={session.account} authProvider={session.authProvider} />;
}
