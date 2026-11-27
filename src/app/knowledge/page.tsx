import { getAuthMode } from "@/modules/auth/auth-mode";
import { getCurrentAccount } from "@/modules/auth/current-account";
import { ConfigurationNotice } from "@/modules/shared/components/configuration-notice";
import { KnowledgeBaseDashboard } from "@/modules/rag/components/knowledge-base-dashboard";

export const dynamic = "force-dynamic";

export default async function KnowledgePage() {
  const authMode = getAuthMode();
  if (authMode === "unconfigured") return <ConfigurationNotice />;

  const session = await getCurrentAccount();
  if (!session) redirect("/");

  return (
    <KnowledgeBaseDashboard
      account={session.account}
      authProvider={session.authProvider}
    />
  );
}
import { redirect } from "next/navigation";
