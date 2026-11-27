import type { SupabaseClient, User } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { AccountInfo } from "@/modules/auth/types";
import { createAvatarService } from "@/modules/account/avatar-service";
import type { Database } from "@/modules/shared/integrations/database.types";
import { AppError, UnauthorizedError } from "@/modules/shared/lib/errors";

const user = {
  id: "user-1",
  email: "alice@example.com",
  user_metadata: { display_name: "Alice", avatar_url: "https://example.com/old.png" },
} as unknown as User;

type SupabaseOptions = {
  profile?: { avatar_url: string | null } | null;
  profileError?: unknown;
  updated?: { id: string } | null;
  updateError?: unknown;
  metadataError?: unknown;
};

function createSupabase(options: SupabaseOptions = {}): SupabaseClient<Database> {
  const from = vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle: vi.fn(async () => ({
          data: options.profile ?? null,
          error: options.profileError ?? null,
        })),
      })),
    })),
    update: vi.fn(() => ({
      eq: vi.fn(() => ({
        select: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({
            data: options.updated ?? null,
            error: options.updateError ?? null,
          })),
        })),
      })),
    })),
  }));

  return {
    from,
    auth: {
      updateUser: vi.fn(async () => ({ error: options.metadataError ?? null })),
    },
  } as unknown as SupabaseClient<Database>;
}

describe("avatar service - local mode", () => {
  const account: AccountInfo = {
    id: "account-1",
    email: "alice@example.com",
    displayName: "Alice",
    avatarUrl: "data:image/png;base64,abc",
  };

  it("returns the local account avatar", async () => {
    const service = createAvatarService({
      getAuthMode: () => "local",
      getLocalAccount: async () => account,
    });

    await expect(service.getAvatar()).resolves.toEqual({
      avatarUrl: account.avatarUrl,
      account,
    });
  });

  it("returns 401 when there is no local session", async () => {
    const service = createAvatarService({
      getAuthMode: () => "local",
      getLocalAccount: async () => null,
    });

    await expect(service.getAvatar()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("updates and clears the local avatar", async () => {
    const updateLocalAvatar = vi.fn(async () => ({ ...account, avatarUrl: null }));

    const service = createAvatarService({
      getAuthMode: () => "local",
      updateLocalAvatar,
      getLocalToken: async () => "token-1",
    });

    await expect(service.updateAvatar(null)).resolves.toEqual({
      success: true,
      avatarUrl: null,
      account: { ...account, avatarUrl: null },
    });
    expect(updateLocalAvatar).toHaveBeenCalledWith("token-1", null);
  });

  it("returns 401 when the local session is invalid during update", async () => {
    const service = createAvatarService({
      getAuthMode: () => "local",
      updateLocalAvatar: async () => null,
      getLocalToken: async () => "invalid",
    });

    await expect(service.updateAvatar(null)).rejects.toMatchObject({
      status: 401,
      message: "Unauthorized or invalid session.",
    });
  });
});

describe("avatar service - Supabase mode", () => {
  it("reads the profile avatar before auth metadata", async () => {
    const supabase = createSupabase({ profile: { avatar_url: "https://example.com/new.png" } });
    const service = createAvatarService({
      getAuthMode: () => "supabase",
      createSupabaseClient: async () => supabase,
      getSupabaseUser: async () => user,
    });

    await expect(service.getAvatar()).resolves.toEqual({
      avatarUrl: "https://example.com/new.png",
    });
  });

  it("falls back to auth metadata when the profile avatar is empty", async () => {
    const supabase = createSupabase({ profile: { avatar_url: null } });
    const service = createAvatarService({
      getAuthMode: () => "supabase",
      createSupabaseClient: async () => supabase,
      getSupabaseUser: async () => user,
    });

    await expect(service.getAvatar()).resolves.toEqual({
      avatarUrl: "https://example.com/old.png",
    });
  });

  it("writes the profile and mirrors auth metadata", async () => {
    const supabase = createSupabase({ updated: { id: user.id } });
    const service = createAvatarService({
      getAuthMode: () => "supabase",
      createSupabaseClient: async () => supabase,
      getSupabaseUser: async () => user,
    });

    const result = await service.updateAvatar("data:image/png;base64,new");

    expect(result).toEqual({
      success: true,
      avatarUrl: "data:image/png;base64,new",
      account: {
        id: user.id,
        email: user.email,
        displayName: "Alice",
        avatarUrl: "data:image/png;base64,new",
      },
    });
    expect(supabase.auth.updateUser).toHaveBeenCalledWith({
      data: { avatar_url: "data:image/png;base64,new" },
    });
  });

  it("does not fail the request when the metadata mirror fails", async () => {
    const supabase = createSupabase({
      updated: { id: user.id },
      metadataError: new Error("metadata unavailable"),
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const service = createAvatarService({
      getAuthMode: () => "supabase",
      createSupabaseClient: async () => supabase,
      getSupabaseUser: async () => user,
    });

    await expect(service.updateAvatar("https://example.com/new.png")).resolves.toMatchObject({
      success: true,
    });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("fails when the profile update errors", async () => {
    const supabase = createSupabase({
      updated: null,
      updateError: new Error("permission denied"),
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const service = createAvatarService({
      getAuthMode: () => "supabase",
      createSupabaseClient: async () => supabase,
      getSupabaseUser: async () => user,
    });

    await expect(service.updateAvatar(null)).rejects.toMatchObject({
      status: 500,
      message: "Could not update the profile avatar.",
    });
    error.mockRestore();
  });

  it("fails when the update matches no profile row", async () => {
    const supabase = createSupabase({ updated: null });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const service = createAvatarService({
      getAuthMode: () => "supabase",
      createSupabaseClient: async () => supabase,
      getSupabaseUser: async () => user,
    });

    await expect(service.updateAvatar(null)).rejects.toMatchObject({
      status: 500,
      message: "Could not update the profile avatar.",
    });
    expect(supabase.auth.updateUser).not.toHaveBeenCalled();
    error.mockRestore();
  });
});

describe("avatar service - unconfigured", () => {
  it("returns a 400 for reads and writes", async () => {
    const service = createAvatarService({ getAuthMode: () => "unconfigured" });

    await expect(service.getAvatar()).rejects.toBeInstanceOf(AppError);
    await expect(service.updateAvatar(null)).rejects.toMatchObject({ status: 400 });
    expect(service.isConfigured()).toBe(false);
  });
});
