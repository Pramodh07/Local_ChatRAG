import "server-only";

import type { AccountInfo, AuthProvider } from "@/modules/auth/types";
import { getAuthMode } from "@/modules/auth/auth-mode";
import { getAuthenticatedLocalAccount } from "@/modules/auth/local-session";
import { createSupabaseServerClient, getSupabaseUser } from "@/modules/auth/supabase-server";

type Profile = {
  email: string | null;
  display_name: string;
  avatar_url?: string | null;
};

function displayNameFor(
  profile: Profile | null,
  metadataName: unknown,
  email: string,
): string {
  return (
    profile?.display_name ||
    (typeof metadataName === "string" ? metadataName : "") ||
    email.split("@")[0] ||
    "Account"
  );
}

export async function getCurrentAccount(): Promise<{
  account: AccountInfo;
  authProvider: AuthProvider;
} | null> {
  const authProvider = getAuthMode();
  if (authProvider === "unconfigured") return null;

  if (authProvider === "local") {
    const account = await getAuthenticatedLocalAccount();
    return account ? { account, authProvider } : null;
  }

  const supabase = await createSupabaseServerClient();
  const user = await getSupabaseUser(supabase);
  if (!user) return null;

  // avatar_url is optional so older databases without migration 0003 still work.
  const { data: profile } = await supabase
    .from("profiles")
    .select("email, display_name, avatar_url")
    .eq("id", user.id)
    .maybeSingle();

  const email = profile?.email ?? user.email ?? "";
  const metadataAvatar = user.user_metadata?.avatar_url;
  const avatarUrl =
    (typeof profile?.avatar_url === "string" ? profile.avatar_url : null) ??
    (typeof metadataAvatar === "string" ? metadataAvatar : null);

  return {
    account: {
      id: user.id,
      email,
      displayName: displayNameFor(profile, user.user_metadata?.display_name, email),
      avatarUrl,
    },
    authProvider,
  };
}
