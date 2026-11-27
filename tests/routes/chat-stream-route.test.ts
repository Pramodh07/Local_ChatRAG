import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Citation } from "@/modules/chat/types";
import type { RetrievedChunk } from "@/modules/shared/integrations/database.types";

const mocks = vi.hoisted(() => ({
  getAuthMode: vi.fn(() => "local"),
  getLocalAccount: vi.fn(),
  createSupabaseClient: vi.fn(),
  getSupabaseUser: vi.fn(),
  getPreferences: vi.fn(),
  isCatalogueModel: vi.fn(() => true),
  estimateCost: vi.fn(() => 0.001),
  consumeRateLimit: vi.fn(),
  createRepository: vi.fn(() => ({ matchDocuments: vi.fn() })),
  buildRagCompletion: vi.fn(),
  streamLocalModelAnswer: vi.fn(),
}));

vi.mock("@/modules/auth/auth-mode", () => ({ getAuthMode: mocks.getAuthMode }));
vi.mock("@/modules/auth/local-session", () => ({
  getAuthenticatedLocalAccount: mocks.getLocalAccount,
}));
vi.mock("@/modules/auth/supabase-server", () => ({
  createSupabaseServerClient: mocks.createSupabaseClient,
  getSupabaseUser: mocks.getSupabaseUser,
}));
vi.mock("@/modules/account/local-account-store", () => ({
  getLocalAccountPreferences: mocks.getPreferences,
}));
vi.mock("@/modules/account/model-catalogue", () => ({
  isCatalogueModel: mocks.isCatalogueModel,
  estimateModelCostUsd: mocks.estimateCost,
}));
vi.mock("@/modules/account/model-stream", () => ({
  streamLocalModelAnswer: mocks.streamLocalModelAnswer,
  estimateStreamTokens: (text: string) => (text ? Math.max(1, Math.ceil(text.length / 4)) : 0),
}));
vi.mock("@/modules/rag/answer-question", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/rag/answer-question")>();
  return { ...actual, buildRagCompletion: mocks.buildRagCompletion };
});
vi.mock("@/modules/rag/rag-repository", () => ({
  createSupabaseRagRepository: mocks.createRepository,
}));
vi.mock("@/modules/shared/integrations/api-rate-limit", () => ({
  consumeApiRateLimit: mocks.consumeRateLimit,
}));

import { POST } from "@/app/api/chat/stream/route";

const account = {
  id: "account-1",
  email: "alice@example.com",
  displayName: "Alice",
  avatarUrl: null,
};

const citation: Citation = {
  id: 1,
  doc: "notes.pdf",
  excerpt: "Revenue grew.",
  score: 0.9,
};

const chunk: RetrievedChunk = {
  id: 1,
  document_id: "doc-1",
  doc_title: "notes.pdf",
  content: "Revenue grew.",
  page: null,
  section: null,
  similarity: 0.9,
};

function streamRequest(body: unknown, signal?: AbortSignal): Request {
  return new Request("http://localhost/api/chat/stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

async function readFrames(response: Response): Promise<any[]> {
  expect(response.headers.get("content-type")).toBe("application/x-ndjson; charset=utf-8");
  expect(response.headers.get("cache-control")).toBe("no-cache, no-transform");
  expect(response.headers.get("x-accel-buffering")).toBe("no");
  const text = await response.text();
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as any);
}

function generator(...chunks: string[]) {
  return vi.fn(async function* () {
    for (const text of chunks) yield text;
  });
}

beforeEach(() => {
  mocks.getAuthMode.mockReturnValue("local");
  mocks.getLocalAccount.mockResolvedValue(account);
  mocks.getPreferences.mockResolvedValue({
    provider: "openai",
    model: "gpt-6.2-sol",
    theme: "light",
  });
  mocks.isCatalogueModel.mockReturnValue(true);
  mocks.estimateCost.mockReturnValue(0.001);
  mocks.consumeRateLimit.mockReset();
  mocks.consumeRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 1 });
  mocks.createSupabaseClient.mockReset();
  mocks.getSupabaseUser.mockReset();
  mocks.buildRagCompletion.mockReset();
  mocks.streamLocalModelAnswer.mockReset();
  mocks.streamLocalModelAnswer.mockImplementation(generator());
});

describe("chat stream route", () => {
  it("streams deltas before a single result frame in local mode", async () => {
    mocks.streamLocalModelAnswer.mockImplementation(generator("Hel", "lo"));

    const response = await POST(streamRequest({ message: "  hello  " }));
    const frames = await readFrames(response);

    expect(response.status).toBe(200);
    expect(frames).toEqual([
      { type: "delta", text: "Hel" },
      { type: "delta", text: "lo" },
      {
        type: "result",
        answer: "Hello",
        citations: [],
        tokens: 2,
        usage: {
          provider: "openai",
          model: "gpt-6.2-sol",
          inputTokens: 0,
          outputTokens: 0,
          estimatedCostUsd: 0.001,
        },
      },
    ]);
    const generationInput = mocks.streamLocalModelAnswer.mock.calls[0][0];
    expect(generationInput.provider).toBe("openai");
    expect(generationInput.model).toBe("gpt-6.2-sol");
    expect(generationInput.message).toBe("hello");
    expect(generationInput.history).toEqual([]);
    expect(generationInput.stats).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(generationInput.signal).toBeInstanceOf(AbortSignal);
  });

  it("uses the selected provider/model and retrieved context for Supabase RAG", async () => {
    mocks.getAuthMode.mockReturnValue("supabase");
    const supabase = { from: vi.fn() };
    mocks.createSupabaseClient.mockResolvedValue(supabase);
    mocks.getSupabaseUser.mockResolvedValue({ id: "user-1" });
    const repository = { matchDocuments: vi.fn() };
    mocks.createRepository.mockReturnValue(repository);
    mocks.buildRagCompletion.mockResolvedValue({
      chunks: [chunk],
      citations: [citation],
      messages: [{ role: "user", content: "<untrusted_document_context>ctx</untrusted_document_context>" }],
    });
    mocks.streamLocalModelAnswer.mockImplementation(generator("Answer [1](#cite-1)"));

    const response = await POST(
      streamRequest({
        message: "question",
        provider: "anthropic",
        model: "claude-sonnet-5-5",
      }),
    );
    const frames = await readFrames(response);

    expect(frames[0]).toEqual({ type: "delta", text: "Answer [1](#cite-1)" });
    expect(frames[1].type).toBe("result");
    expect(frames[1].answer).toBe("Answer [1](#cite-1)");
    expect(frames[1].tokens).toBe(5);
    expect(frames[1].usage.provider).toBe("anthropic");
    expect(frames[1].usage.model).toBe("claude-sonnet-5-5");
    expect(frames[1].citations).toEqual([citation]);
    expect(mocks.buildRagCompletion).toHaveBeenCalledWith(
      "question",
      [],
      repository,
      undefined,
      expect.any(AbortSignal),
    );
    const generationInput = mocks.streamLocalModelAnswer.mock.calls[0][0];
    expect(generationInput.provider).toBe("anthropic");
    expect(generationInput.model).toBe("claude-sonnet-5-5");
    expect(generationInput.message).toBe(
      "<untrusted_document_context>ctx</untrusted_document_context>",
    );
    expect(generationInput.history).toEqual([]);
    expect(generationInput.systemPrompt).toContain("source numbers 1 through 1");
    expect(mocks.consumeRateLimit).toHaveBeenCalledWith(supabase, "chat");
  });

  it("returns the no-documents fallback without calling a provider", async () => {
    mocks.getAuthMode.mockReturnValue("supabase");
    mocks.createSupabaseClient.mockResolvedValue({});
    mocks.getSupabaseUser.mockResolvedValue({ id: "user-1" });
    mocks.buildRagCompletion.mockResolvedValue({ chunks: [], citations: [], messages: [] });

    const response = await POST(streamRequest({ message: "question" }));
    const frames = await readFrames(response);

    expect(frames).toHaveLength(2);
    expect(frames[0].type).toBe("delta");
    expect(frames[1]).toMatchObject({
      type: "result",
      answer: frames[0].text,
      citations: [],
      tokens: 0,
    });
    expect(mocks.streamLocalModelAnswer).not.toHaveBeenCalled();
  });

  it("sends an error frame when generation fails after streaming starts", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.streamLocalModelAnswer.mockImplementation(
      vi.fn(async function* () {
        yield "partial";
        throw new Error("upstream exploded");
      }),
    );

    const response = await POST(streamRequest({ message: "question" }));
    const frames = await readFrames(response);

    expect(frames).toEqual([
      { type: "delta", text: "partial" },
      {
        type: "error",
        message: "The response could not be generated. Check the server logs and try again.",
      },
    ]);
    consoleSpy.mockRestore();
  });

  it("returns JSON errors before streaming for auth, validation, and rate limits", async () => {
    mocks.getLocalAccount.mockResolvedValue(null);
    const unauthorized = await POST(streamRequest({ message: "question" }));
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("content-type")).toContain("application/json");
    await expect(unauthorized.json()).resolves.toEqual({ error: "Sign in to use this endpoint." });

    mocks.getLocalAccount.mockResolvedValue(account);
    const invalid = await POST(streamRequest({ message: "" }));
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toEqual({
      error: "Provide a message of 1–4,000 characters and at most 8 valid history turns.",
    });
    expect(mocks.streamLocalModelAnswer).not.toHaveBeenCalled();

    mocks.getAuthMode.mockReturnValue("supabase");
    mocks.createSupabaseClient.mockResolvedValue({});
    mocks.getSupabaseUser.mockResolvedValue({ id: "user-1" });
    mocks.consumeRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 30 });
    const limited = await POST(streamRequest({ message: "question" }));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("30");
    await expect(limited.json()).resolves.toEqual({
      error: "Chat request limit reached. Please wait before trying again.",
    });
  });

  it("returns 499 for an aborted request", async () => {
    const controller = new AbortController();
    controller.abort();

    const response = await POST(streamRequest({ message: "question" }, controller.signal));

    expect(response.status).toBe(499);
  });
});
