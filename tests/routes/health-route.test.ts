import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConfig: vi.fn(),
}));

vi.mock("@/modules/shared/config/providers", () => ({
  getProviderConfig: mocks.getProviderConfig,
}));

import { GET } from "@/app/api/health/route";

describe("GET /api/health", () => {
  beforeEach(() => {
    mocks.getProviderConfig.mockReset();
  });

  it("reports configured providers without exposing secrets", async () => {
    mocks.getProviderConfig.mockReturnValue({
      configured: true,
      auth: "supabase",
      database: "supabase",
    });

    const response = GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      status: "ok",
      authProvider: "supabase",
      databaseProvider: "supabase",
    });
    expect(body).not.toHaveProperty("reason");
    expect(body).not.toHaveProperty("SUPABASE_SERVICE_ROLE_KEY");
    expect(body.timestamp).toEqual(expect.any(String));
  });

  it("reports an unconfigured deployment with the fail-closed reason", async () => {
    mocks.getProviderConfig.mockReturnValue({
      configured: false,
      auth: "unconfigured",
      database: "unconfigured",
      reason: "Local authentication is available only in development.",
    });

    const response = GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "unconfigured",
      reason: "Local authentication is available only in development.",
    });
  });
});
