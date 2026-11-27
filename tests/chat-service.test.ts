import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { AccountPreferences } from "@/modules/account/types";
import type { ChatResponse } from "@/modules/chat/types";
import { createChatService } from "@/modules/chat/chat-service";
import { DEFAULT_CHAT_RUNTIME_SETTINGS } from "@/modules/chat/runtime-settings";
import { ConflictError, RateLimitExceededError, ServiceConfigurationError, UpstreamError } from "@/modules/shared/lib/errors";
import type { Database } from "@/modules/shared/integrations/database.types";
import type { RetrievalRepository } from "@/modules/rag/rag-repository";

const preferences: AccountPreferences = {
  provider: "openai",
  model: "gpt-6.2-sol",
  theme: "light",
};

const repository: RetrievalRepository = {
  matchDocuments: async () => [],
};

const supabase = {} as SupabaseClient<Database>;
const signal = new AbortController().signal;

function createDependencies() {
  return {
    getPreferences: vi.fn(async () => preferences),
    recordUsage: vi.fn(async () => {}),
    generateLocalAnswer: vi.fn(async () => ({
      answer: "Answer",
      inputTokens: 10,
      outputTokens: 20,
    })),
    isCatalogueModel: vi.fn(() => true),
    estimateCost: vi.fn(() => 0.25),
    consumeRateLimit: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 1 })),
    answerQuestion: vi.fn(async (): Promise<ChatResponse> => ({
      answer: "RAG answer",
      citations: [],
      tokens: 5,
    })),
    createRepository: vi.fn(() => repository),
  };
}

describe("chat service - local models", () => {
  it("returns the model answer and records usage", async () => {
    const dependencies = createDependencies();
    const service = createChatService(dependencies);

    const response = await service.answerLocally(
      "account-1",
      { message: "hello", history: [{ role: "user", content: "earlier" }] },
      signal,
    );

    expect(response).toEqual({
      answer: "Answer",
      citations: [],
      tokens: 30,
      usage: {
        provider: "openai",
        model: "gpt-6.2-sol",
        inputTokens: 10,
        outputTokens: 20,
        estimatedCostUsd: 0.25,
      },
    });
    expect(dependencies.recordUsage).toHaveBeenCalledWith("account-1", {
      provider: "openai",
      model: "gpt-6.2-sol",
      inputTokens: 10,
      outputTokens: 20,
      estimatedCostUsd: 0.25,
      costEstimateComplete: true,
    });
    expect(dependencies.generateLocalAnswer).toHaveBeenCalledWith(
      "openai",
      "gpt-6.2-sol",
      "hello",
      [{ role: "user", content: "earlier" }],
      signal,
      DEFAULT_CHAT_RUNTIME_SETTINGS,
    );
  });

  it("rejects a saved model that is no longer in the catalogue", async () => {
    const dependencies = createDependencies();
    dependencies.isCatalogueModel.mockReturnValue(false);
    const service = createChatService(dependencies);

    await expect(
      service.answerLocally("account-1", { message: "hello", history: [] }, signal),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(dependencies.generateLocalAnswer).not.toHaveBeenCalled();
  });

  it("converts provider configuration errors into a 503", async () => {
    const dependencies = createDependencies();
    dependencies.generateLocalAnswer.mockRejectedValue(
      new Error("Set OPENAI_API_KEY in your web/.env.local file."),
    );
    const service = createChatService(dependencies);

    await expect(
      service.answerLocally("account-1", { message: "hello", history: [] }, signal),
    ).rejects.toBeInstanceOf(ServiceConfigurationError);
    await expect(
      service.answerLocally("account-1", { message: "hello", history: [] }, signal),
    ).rejects.toThrow("Set OPENAI_API_KEY");
  });

  it("converts other provider failures into a 502", async () => {
    const dependencies = createDependencies();
    dependencies.generateLocalAnswer.mockRejectedValue(new Error("provider exploded"));
    const service = createChatService(dependencies);

    await expect(
      service.answerLocally("account-1", { message: "hello", history: [] }, signal),
    ).rejects.toBeInstanceOf(UpstreamError);
  });

  it("rejects an empty model answer", async () => {
    const dependencies = createDependencies();
    dependencies.generateLocalAnswer.mockResolvedValue({
      answer: "   ",
      inputTokens: 1,
      outputTokens: 0,
    });
    const service = createChatService(dependencies);

    await expect(
      service.answerLocally("account-1", { message: "hello", history: [] }, signal),
    ).rejects.toThrow("The selected model returned an empty response.");
  });
});

describe("chat service - RAG", () => {
  it("throws a 429 with a retry hint when the rate limit is exhausted", async () => {
    const dependencies = createDependencies();
    dependencies.consumeRateLimit.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 42,
    });
    const service = createChatService(dependencies);

    await expect(
      service.answerWithRag(supabase, { message: "hello", history: [] }, signal),
    ).rejects.toMatchObject({
      status: 429,
      retryAfterSeconds: 42,
      message: "Chat request limit reached. Please wait before trying again.",
    });
    expect(dependencies.answerQuestion).not.toHaveBeenCalled();
  });

  it("retrieves through the repository when the request is allowed", async () => {
    const dependencies = createDependencies();
    const service = createChatService(dependencies);

    const response = await service.answerWithRag(
      supabase,
      { message: "hello", history: [{ role: "user", content: "earlier" }] },
      signal,
    );

    expect(response.answer).toBe("RAG answer");
    expect(dependencies.consumeRateLimit).toHaveBeenCalledWith(supabase, "chat");
    expect(dependencies.createRepository).toHaveBeenCalledWith(supabase);
    expect(dependencies.answerQuestion).toHaveBeenCalledWith(
      "hello",
      [{ role: "user", content: "earlier" }],
      repository,
      signal,
      DEFAULT_CHAT_RUNTIME_SETTINGS,
    );
  });

  it("wraps a blocked rate limit in the typed error", async () => {
    const dependencies = createDependencies();
    dependencies.consumeRateLimit.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 5,
    });
    const service = createChatService(dependencies);

    await expect(
      service.answerWithRag(supabase, { message: "hello", history: [] }, signal),
    ).rejects.toBeInstanceOf(RateLimitExceededError);
  });
});
