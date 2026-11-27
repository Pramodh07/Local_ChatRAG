import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getAuthMode, type AuthMode } from "@/modules/auth/auth-mode";
import { getAuthenticatedLocalAccount, getLocalSessionToken } from "@/modules/auth/local-session";
import { updateLocalAvatar } from "@/modules/auth/local-auth";
import { createSupabaseServerClient, getSupabaseUser } from "@/modules/auth/supabase-server";
import type { AccountInfo } from "@/modules/auth/types";
import type { Database } from "@/modules/shared/integrations/database.types";
import { AppError, UnauthorizedError } from "@/modules/shared/lib/errors";

export type AvatarState = {
  avatarUrl: string | null;
  account?: AccountInfo;
};

export type AvatarUpdate = {
  success: true;
  avatarUrl: string | null;
  account: AccountInfo;
};

type AvatarDependencies = {
  getAuthMode: () => AuthMode;
  getLocalAccount: () => Promise<AccountInfo | null>;
  getLocalToken: () => Promise<string | undefined>;
  updateLocalAvatar: (
    token: string | undefined,
    avatarUrl: string | null,
  ) => Promise<AccountInfo | null>;
  createSupabaseClient: () => Promise<SupabaseClient<Database>>;
  getSupabaseUser: (supabase: SupabaseClient<Database>) => Promise<User | null>;
};

function toAccount(user: User, avatarUrl: string | null): AccountInfo {
  return {
    id: user.id,
    email: user.email ?? "",
    displayName:
      (typeof user.user_metadata?.display_name === "string" ? user.user_metadata.display_name : "") ||
      user.email?.split("@")[0] ||
      "Account",
    avatarUrl,
  };
}

export function createAvatarService(overrides: Partial<AvatarDependencies> = {}) {
  const dependencies: AvatarDependencies = {
    getAuthMode,
    getLocalAccount: getAuthenticatedLocalAccount,
    getLocalToken: getLocalSessionToken,
    updateLocalAvatar,
    createSupabaseClient: createSupabaseServerClient,
    getSupabaseUser,
    ...overrides,
  };

  async function requireSupabaseUser() {
    const supabase = await dependencies.createSupabaseClient();
    const user = await dependencies.getSupabaseUser(supabase);
    if (!user) throw new UnauthorizedError();
    return { supabase, user };
  }

  return {
    isConfigured(): boolean {
      return dependencies.getAuthMode() !== "unconfigured";
    },

    async getAvatar(): Promise<AvatarState> {
      const authMode = dependencies.getAuthMode();
      if (authMode === "unconfigured") {
        throw new AppError("Auth is unconfigured.", {
          status: 400,
          code: "auth_unconfigured",
          expose: true,
        });
      }

      if (authMode === "local") {
        const account = await dependencies.getLocalAccount();
        if (!account) throw new UnauthorizedError();
        return { avatarUrl: account.avatarUrl ?? null, account };
      }

      const { supabase, user } = await requireSupabaseUser();
      const { data: profile } = await supabase
        .from("profiles")
        .select("avatar_url")
        .eq("id", user.id)
        .maybeSingle();
      const metadataAvatar = user.user_metadata?.avatar_url;

      return {
        avatarUrl:
          profile?.avatar_url ??
          (typeof metadataAvatar === "string" ? metadataAvatar : null),
      };
    },

    async updateAvatar(avatarUrl: string | null): Promise<AvatarUpdate> {
      const authMode = dependencies.getAuthMode();
      if (authMode === "unconfigured") {
        throw new AppError("Auth is unconfigured.", {
          status: 400,
          code: "auth_unconfigured",
          expose: true,
        });
      }

      if (authMode === "local") {
        const updated = await dependencies.updateLocalAvatar(
          await dependencies.getLocalToken(),
          avatarUrl,
        );
        if (!updated) throw new UnauthorizedError("Unauthorized or invalid session.");
        return { success: true, avatarUrl: updated.avatarUrl ?? null, account: updated };
      }

      const { supabase, user } = await requireSupabaseUser();
      const { data: updatedProfile, error: profileError } = await supabase
        .from("profiles")
        .update({ avatar_url: avatarUrl })
        .eq("id", user.id)
        .select("id")
        .maybeSingle();
      if (profileError) {
        console.error("Failed to update the profile avatar.", profileError);
        throw new AppError("Could not update the profile avatar.", {
          status: 500,
          code: "avatar_update_failed",
          expose: true,
        });
      }
      if (!updatedProfile) {
        console.error("Avatar update matched no profile row.", { userId: user.id });
        throw new AppError("Could not update the profile avatar.", {
          status: 500,
          code: "avatar_update_failed",
          expose: true,
        });
      }

      // Keep auth metadata in sync for older clients, but the profile column is
      // the source of truth. A metadata mirror failure must not fail the request.
      const { error: metadataError } = await supabase.auth.updateUser({
        data: { avatar_url: avatarUrl },
      });
      if (metadataError) {
        console.warn("Failed to mirror the avatar into auth metadata.", metadataError);
      }

      return { success: true, avatarUrl, account: toAccount(user, avatarUrl) };
    },
  };
}

export type AvatarService = ReturnType<typeof createAvatarService>;
