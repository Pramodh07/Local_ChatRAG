import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConflictError,
  RateLimitCheckError,
  RateLimitExceededError,
} from "@/modules/shared/lib/errors";

const mocks = vi.hoisted(() => ({
  getAuthMode: vi.fn(() => "local"),
  getLocalAccount: vi.fn(),
  createSupabaseClient: vi.fn(),
  getSupabaseUser: vi.fn(),
  answerLocally: vi.fn(),
  answerWithRag: vi.fn(),
}));

vi.mock("@/modules/auth/auth-mode", () => ({ getAuthMode: mocks.getAuthMode }));
vi.mock("@/modules/auth/local-session", () => ({
  getAuthenticatedLocalAccount: mocks.getLocalAccount,
}));
vi.mock("@/modules/auth/supabase-server", () => ({
  createSupabaseServerClient: mocks.createSupabaseClient,
  getSupabaseUser: mocks.getSupabaseUser,
}));
vi.mock("@/modules/chat/chat-service", () => ({
  createChatService: () => ({
    answerLocally: mocks.answerLocally,
    answerWithRag: mocks.answerWithRag,
  }),
}));

import { POST } from "@/app/api/chat/route";

const account = {
  id: "account-1",
  email: "alice@example.com",
  displayName: "Alice",
  avatarUrl: null,
};

function chatRequest(body: unknown, headers: HeadersInit = {}): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.getAuthMode.mockReturnValue("local");
  mocks.getLocalAccount.mockResolvedValue(account);
  mocks.answerLocally.mockReset();
  mocks.answerWithRag.mockReset();
  mocks.createSupabaseClient.mockReset();
  mocks.getSupabaseUser.mockReset();
});

describe("chat route contract", () => {
  it("returns 401 before parsing the body when unauthenticated", async () => {
    mocks.getLocalAccount.mockResolvedValue(null);

    const response = await POST(chatRequest({ message: "" }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Sign in to use this endpoint." });
    expect(mocks.answerLocally).not.toHaveBeenCalled();
  });

  it("validates and forwards a local chat request", async () => {
    mocks.answerLocally.mockResolvedValue({
      answer: "Hello",
      citations: [],
      tokens: 3,
    });

    const response = await POST(chatRequest({ message: "  hello  " }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      answer: "Hello",
      citations: [],
      tokens: 3,
    });
    expect(mocks.answerLocally).toHaveBeenCalledWith(
      "account-1",
      { message: "hello", history: [] },
      expect.any(AbortSignal),
    );
  });

  it("ignores a browser-supplied provider key header", async () => {
    mocks.answerLocally.mockResolvedValue({ answer: "Hello", citations: [], tokens: 1 });

    await POST(chatRequest({ message: "hello" }, { "x-atlas-provider-key": "user-key" }));

    expect(mocks.answerLocally).toHaveBeenCalledWith(
      "account-1",
      { message: "hello", history: [] },
      expect.any(AbortSignal),
    );
  });

  it("rejects invalid chat bodies with the validation message", async () => {
    const response = await POST(chatRequest({ message: "" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Provide a message of 1–4,000 characters and at most 8 valid history turns.",
    });
    expect(mocks.answerLocally).not.toHaveBeenCalled();
  });

  it("maps a conflict from the service to 409", async () => {
    mocks.answerLocally.mockRejectedValue(
      new ConflictError("The saved model selection is invalid."),
    );

    const response = await POST(chatRequest({ message: "hello" }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "The saved model selection is invalid.",
    });
  });

  it("maps rate-limit exhaustion to 429 with Retry-After", async () => {
    mocks.answerLocally.mockRejectedValue(
      new RateLimitExceededError("Too many requests.", 30),
    );

    const response = await POST(chatRequest({ message: "hello" }));

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("30");
    await expect(response.json()).resolves.toEqual({ error: "Too many requests." });
  });

  it("maps rate-limit infrastructure failures to the chat message", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.answerLocally.mockRejectedValue(new RateLimitCheckError(new Error("db down")));

    const response = await POST(chatRequest({ message: "hello" }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Chat is temporarily unavailable. Try again shortly.",
    });
    error.mockRestore();
  });

  it("uses the local fallback for unexpected local failures", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.answerLocally.mockRejectedValue(new Error("boom"));

    const response = await POST(chatRequest({ message: "hello" }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Local model chat failed. Check the server logs and local provider setup.",
    });
    error.mockRestore();
  });

  it("returns 401 for an unauthenticated Supabase request", async () => {
    mocks.getAuthMode.mockReturnValue("supabase");
    mocks.createSupabaseClient.mockResolvedValue({});
    mocks.getSupabaseUser.mockResolvedValue(null);

    const response = await POST(chatRequest({ message: "hello" }));

    expect(response.status).toBe(401);
    expect(mocks.answerWithRag).not.toHaveBeenCalled();
  });

  it("forwards an authenticated Supabase request to the RAG service", async () => {
    mocks.getAuthMode.mockReturnValue("supabase");
    const supabase = {};
    mocks.createSupabaseClient.mockResolvedValue(supabase);
    mocks.getSupabaseUser.mockResolvedValue({ id: "user-1" });
    mocks.answerWithRag.mockResolvedValue({ answer: "RAG", citations: [], tokens: 1 });

    const response = await POST(chatRequest({ message: "hello" }));

    expect(response.status).toBe(200);
    expect(mocks.answerWithRag).toHaveBeenCalledWith(
      supabase,
      { message: "hello", history: [] },
      expect.any(AbortSignal),
    );
  });
});
