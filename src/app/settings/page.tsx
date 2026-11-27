import { AccountRoute } from "@/modules/account/account-route";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return <AccountRoute section="settings" />;
}
