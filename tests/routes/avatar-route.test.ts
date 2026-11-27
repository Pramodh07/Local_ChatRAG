import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError, UnauthorizedError } from "@/modules/shared/lib/errors";

const mocks = vi.hoisted(() => ({
  isConfigured: vi.fn(() => true),
  getAvatar: vi.fn(),
  updateAvatar: vi.fn(),
}));

vi.mock("@/modules/account/avatar-service", () => ({
  createAvatarService: () => mocks,
}));

import { DELETE, GET, POST } from "@/app/api/account/avatar/route";

beforeEach(() => {
  mocks.isConfigured.mockReturnValue(true);
  mocks.getAvatar.mockReset();
  mocks.updateAvatar.mockReset();
});

describe("avatar route contract", () => {
  it("returns the avatar state", async () => {
    mocks.getAvatar.mockResolvedValue({ avatarUrl: "https://example.com/a.png" });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({
      avatarUrl: "https://example.com/a.png",
    });
  });

  it("maps an unauthenticated read to 401", async () => {
    mocks.getAvatar.mockRejectedValue(new UnauthorizedError());

    const response = await GET();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized." });
  });

  it("rejects an invalid JSON payload before calling the service", async () => {
    const response = await POST(
      new Request("http://localhost/api/account/avatar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not-json",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid JSON body." });
    expect(mocks.updateAvatar).not.toHaveBeenCalled();
  });

  it("passes a valid avatar URL to the service", async () => {
    mocks.updateAvatar.mockResolvedValue({
      success: true,
      avatarUrl: "https://example.com/a.png",
      account: { id: "1", email: "a@example.com", displayName: "A", avatarUrl: null },
    });

    const response = await POST(
      new Request("http://localhost/api/account/avatar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ avatarUrl: "https://example.com/a.png" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.updateAvatar).toHaveBeenCalledWith("https://example.com/a.png");
  });

  it("checks configuration before parsing the body", async () => {
    mocks.isConfigured.mockReturnValue(false);

    const response = await POST(
      new Request("http://localhost/api/account/avatar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not-json",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Auth is unconfigured." });
  });

  it("maps a profile update failure to 500", async () => {
    mocks.updateAvatar.mockRejectedValue(
      new AppError("Could not update the profile avatar.", {
        status: 500,
        code: "avatar_update_failed",
        expose: true,
      }),
    );

    const response = await POST(
      new Request("http://localhost/api/account/avatar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ avatarUrl: null }),
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Could not update the profile avatar.",
    });
  });

  it("clears the avatar through DELETE", async () => {
    mocks.updateAvatar.mockResolvedValue({
      success: true,
      avatarUrl: null,
      account: { id: "1", email: "a@example.com", displayName: "A", avatarUrl: null },
    });

    const response = await DELETE();

    expect(response.status).toBe(200);
    expect(mocks.updateAvatar).toHaveBeenCalledWith(null);
  });
});
