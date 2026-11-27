import { describe, expect, it } from "vitest";
import { resolveProviderConfig } from "@/modules/shared/config/providers";

const SUPABASE_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-key",
};

describe("provider configuration", () => {
  it("keeps AUTH_MODE=local working in development", () => {
    expect(
      resolveProviderConfig({ NODE_ENV: "development", AUTH_MODE: "local" }),
    ).toEqual({ configured: true, auth: "local", database: "local" });
  });

  it("derives Supabase data access from AUTH_MODE=supabase", () => {
    expect(
      resolveProviderConfig({ NODE_ENV: "production", AUTH_MODE: "supabase", ...SUPABASE_ENV }),
    ).toEqual({ configured: true, auth: "supabase", database: "supabase" });
  });

  it("prefers explicit providers over the legacy AUTH_MODE alias", () => {
    expect(
      resolveProviderConfig({
        NODE_ENV: "production",
        AUTH_MODE: "local",
        AUTH_PROVIDER: "supabase",
        DATABASE_PROVIDER: "supabase",
        ...SUPABASE_ENV,
      }),
    ).toEqual({ configured: true, auth: "supabase", database: "supabase" });
  });

  it("rejects unsupported provider values", () => {
    const auth = resolveProviderConfig({
      NODE_ENV: "development",
      AUTH_PROVIDER: "oauth",
    });
    expect(auth.configured).toBe(false);
    if (!auth.configured) expect(auth.reason).toMatch(/AUTH_PROVIDER/);

    const database = resolveProviderConfig({
      NODE_ENV: "development",
      AUTH_MODE: "local",
      DATABASE_PROVIDER: "mysql",
    });
    expect(database.configured).toBe(false);
    if (!database.configured) expect(database.reason).toMatch(/DATABASE_PROVIDER/);
  });

  it("allows local auth with the embedded PostgreSQL runtime in development", () => {
    expect(
      resolveProviderConfig({
        NODE_ENV: "development",
        AUTH_PROVIDER: "local",
        DATABASE_PROVIDER: "postgres",
      }),
    ).toEqual({ configured: true, auth: "local", database: "postgres" });
  });

  it("does not enable the embedded PostgreSQL runtime outside development", () => {
    expect(
      resolveProviderConfig({
        NODE_ENV: "production",
        AUTH_PROVIDER: "local",
        DATABASE_PROVIDER: "postgres",
      }),
    ).toMatchObject({ configured: false });
  });

  it("fails closed for unsupported provider pairings", () => {
    const localAuthRemoteData = resolveProviderConfig({
      NODE_ENV: "development",
      AUTH_PROVIDER: "local",
      DATABASE_PROVIDER: "supabase",
    });
    expect(localAuthRemoteData.configured).toBe(false);
    if (!localAuthRemoteData.configured) {
      expect(localAuthRemoteData.reason).toMatch(/row-level security/);
    }

    const remoteAuthLocalData = resolveProviderConfig({
      NODE_ENV: "production",
      AUTH_PROVIDER: "supabase",
      DATABASE_PROVIDER: "local",
      ...SUPABASE_ENV,
    });
    expect(remoteAuthLocalData.configured).toBe(false);
    if (!remoteAuthLocalData.configured) {
      expect(remoteAuthLocalData.reason).toMatch(/requires DATABASE_PROVIDER=supabase/);
    }

    const remoteAuthEmbeddedData = resolveProviderConfig({
      NODE_ENV: "development",
      AUTH_PROVIDER: "supabase",
      DATABASE_PROVIDER: "postgres",
      ...SUPABASE_ENV,
    });
    expect(remoteAuthEmbeddedData.configured).toBe(false);
    if (!remoteAuthEmbeddedData.configured) {
      expect(remoteAuthEmbeddedData.reason).toMatch(/requires DATABASE_PROVIDER=supabase/);
    }
  });

  it("does not enable local authentication outside development", () => {
    expect(
      resolveProviderConfig({ NODE_ENV: "production", AUTH_PROVIDER: "local" }),
    ).toMatchObject({ configured: false });
    expect(resolveProviderConfig({ NODE_ENV: "test", AUTH_MODE: "local" })).toMatchObject({
      configured: false,
    });
  });

  it("requires both Supabase values together", () => {
    expect(
      resolveProviderConfig({
        NODE_ENV: "production",
        AUTH_PROVIDER: "supabase",
        NEXT_PUBLIC_SUPABASE_URL: SUPABASE_ENV.NEXT_PUBLIC_SUPABASE_URL,
      }),
    ).toMatchObject({ configured: false });

    expect(resolveProviderConfig({ NODE_ENV: "production" })).toMatchObject({
      configured: false,
    });
  });

  it("infers Supabase when the legacy switch is absent and credentials exist", () => {
    expect(resolveProviderConfig({ NODE_ENV: "production", ...SUPABASE_ENV })).toEqual({
      configured: true,
      auth: "supabase",
      database: "supabase",
    });
  });
});
