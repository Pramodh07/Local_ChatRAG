import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthMode: vi.fn(() => "local"),
  getLocalAccount: vi.fn(),
  createSupabaseClient: vi.fn(),
  getSupabaseUser: vi.fn(),
  testConnection: vi.fn(),
}));

vi.mock("@/modules/auth/auth-mode", () => ({ getAuthMode: mocks.getAuthMode }));
vi.mock("@/modules/auth/local-session", () => ({
  getAuthenticatedLocalAccount: mocks.getLocalAccount,
}));
vi.mock("@/modules/auth/supabase-server", () => ({
  createSupabaseServerClient: mocks.createSupabaseClient,
  getSupabaseUser: mocks.getSupabaseUser,
}));
vi.mock("@/modules/account/provider-connection", () => ({
  testProviderConnection: mocks.testConnection,
}));

import { POST } from "@/app/api/account/models/test/route";

function request(provider: unknown, key?: string) {
  return new Request("http://localhost/api/account/models/test", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // Browser-supplied keys are deliberately ignored: the server uses env keys only.
      ...(key ? { "x-atlas-provider-key": key } : {}),
    },
    body: JSON.stringify({ provider }),
  });
}

beforeEach(() => {
  mocks.getAuthMode.mockReturnValue("local");
  mocks.getLocalAccount.mockResolvedValue({ id: "account-1" });
  mocks.testConnection.mockReset();
  mocks.testConnection.mockResolvedValue(undefined);
});

describe("provider connection route", () => {
  it("tests the requested provider using server configuration only", async () => {
    const response = await POST(request("openai", "user-key"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ connected: true });
    expect(mocks.testConnection).toHaveBeenCalledWith("openai");
  });

  it("rejects unknown providers", async () => {
    const response = await POST(request("custom"));

    expect(response.status).toBe(400);
    expect(mocks.testConnection).not.toHaveBeenCalled();
  });

  it("ignores oversized provider key headers rather than validating them", async () => {
    const response = await POST(request("openai", "k".repeat(513)));

    expect(response.status).toBe(200);
    expect(mocks.testConnection).toHaveBeenCalledWith("openai");
  });

  it("requires an authenticated account", async () => {
    mocks.getLocalAccount.mockResolvedValue(null);

    const response = await POST(request("openai"));

    expect(response.status).toBe(401);
    expect(mocks.testConnection).not.toHaveBeenCalled();
  });
});
