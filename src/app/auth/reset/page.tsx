import { ResetPasswordScreen } from "@/modules/auth/components/reset-password-screen";
import { getAuthMode } from "@/modules/auth/auth-mode";

export const dynamic = "force-dynamic";

export default function ResetPasswordPage() {
  return <ResetPasswordScreen enabled={getAuthMode() === "supabase"} />;
}
