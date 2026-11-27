import { AccountRoute } from "@/modules/account/account-route";

export const dynamic = "force-dynamic";

export default function AccountPage() {
  return <AccountRoute section="account" />;
}
