import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatHistoryTurn, ChatResponse } from "@/modules/chat/types";
import type { AccountPreferences, ModelProvider, UsageBucket } from "@/modules/account/types";
import type { Database } from "@/modules/shared/integrations/database.types";
import type { ChatRequest } from "@/modules/chat/chat-request";
import { DEFAULT_CHAT_RUNTIME_SETTINGS, type ChatRuntimeSettings } from "@/modules/chat/runtime-settings";
import {
  consumeApiRateLimit,
  type RateLimitedAction,
} from "@/modules/shared/integrations/api-rate-limit";
import {
  ConflictError,
  RateLimitExceededError,
  ServiceConfigurationError,
  UpstreamError,
} from "@/modules/shared/lib/errors";
import { answerQuestion } from "@/modules/rag/answer-question";
import {
  createSupabaseRagRepository,
  type RetrievalRepository,
} from "@/modules/rag/rag-repository";
import {
  getLocalAccountPreferences,
  recordLocalModelUsage,
} from "@/modules/account/local-account-store";
import { estimateModelCostUsd, isCatalogueModel } from "@/modules/account/model-catalogue";
import { generateLocalModelAnswer } from "@/modules/account/local-model-runtime";

type LocalGenerationResult = Awaited<ReturnType<typeof generateLocalModelAnswer>>;

type ChatServiceDependencies = {
  getPreferences: (accountId: string) => Promise<AccountPreferences>;
  recordUsage: (
    accountId: string,
    usage: Omit<UsageBucket, "date" | "requests">,
  ) => Promise<void>;
  generateLocalAnswer: (
    provider: ModelProvider,
    model: string,
    message: string,
    history: ChatHistoryTurn[],
    signal: AbortSignal,
    settings?: ChatRuntimeSettings,
  ) => Promise<LocalGenerationResult>;
  isCatalogueModel: (provider: ModelProvider, model: string) => boolean;
  estimateCost: (
    provider: ModelProvider,
    model: string,
    inputTokens: number,
    outputTokens: number,
  ) => number | null;
  consumeRateLimit: (
    supabase: SupabaseClient<Database>,
    action: RateLimitedAction,
  ) => Promise<{ allowed: boolean; retryAfterSeconds: number }>;
  answerQuestion: (
    message: string,
    history: ChatHistoryTurn[],
    repository: RetrievalRepository,
    signal: AbortSignal,
    settings?: ChatRuntimeSettings,
  ) => Promise<ChatResponse>;
  createRepository: (supabase: SupabaseClient<Database>) => RetrievalRepository;
};

/** Configuration failures are shown to the operator; provider failures are not. */
function configurationMessageFor(error: unknown): string | null {
  if (error instanceof ServiceConfigurationError) return error.message;
  if (error instanceof Error && /^(Set|Add) /.test(error.message)) return error.message;
  return null;
}

export function createChatService(overrides: Partial<ChatServiceDependencies> = {}) {
  const dependencies: ChatServiceDependencies = {
    getPreferences: getLocalAccountPreferences,
    recordUsage: recordLocalModelUsage,
    generateLocalAnswer: generateLocalModelAnswer,
    isCatalogueModel,
    estimateCost: estimateModelCostUsd,
    consumeRateLimit: consumeApiRateLimit,
    answerQuestion,
    createRepository: createSupabaseRagRepository,
    ...overrides,
  };

  return {
    async answerLocally(
      accountId: string,
      request: ChatRequest,
      signal: AbortSignal,
    ): Promise<ChatResponse> {
      const preferences = await dependencies.getPreferences(accountId);
      if (!dependencies.isCatalogueModel(preferences.provider, preferences.model)) {
        throw new ConflictError(
          "The saved model selection is invalid. Choose a supported model in Models.",
        );
      }

      let result: LocalGenerationResult;
      try {
        result = await dependencies.generateLocalAnswer(
          preferences.provider,
          preferences.model,
          request.message,
          request.history,
          signal,
          request.settings ?? DEFAULT_CHAT_RUNTIME_SETTINGS,
        );
      } catch (error) {
        const configurationMessage = configurationMessageFor(error);
        if (configurationMessage) throw new ServiceConfigurationError(configurationMessage);
        throw new UpstreamError(
          "The selected model request failed. Check its provider configuration and try again.",
          error,
        );
      }

      if (!result.answer.trim()) {
        throw new UpstreamError("The selected model returned an empty response.");
      }

      const estimatedCostUsd = dependencies.estimateCost(
        preferences.provider,
        preferences.model,
        result.inputTokens,
        result.outputTokens,
      );
      await dependencies.recordUsage(accountId, {
        provider: preferences.provider,
        model: preferences.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        estimatedCostUsd: estimatedCostUsd ?? 0,
        costEstimateComplete: estimatedCostUsd !== null,
      });

      return {
        answer: result.answer,
        citations: [],
        tokens: result.inputTokens + result.outputTokens,
        usage: {
          provider: preferences.provider,
          model: preferences.model,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          estimatedCostUsd,
        },
      };
    },

    async answerWithRag(
      supabase: SupabaseClient<Database>,
      request: ChatRequest,
      signal: AbortSignal,
    ): Promise<ChatResponse> {
      const rateLimit = await dependencies.consumeRateLimit(supabase, "chat");
      if (!rateLimit.allowed) {
        throw new RateLimitExceededError(
          "Chat request limit reached. Please wait before trying again.",
          rateLimit.retryAfterSeconds,
        );
      }

      return dependencies.answerQuestion(
        request.message,
        request.history,
        dependencies.createRepository(supabase),
        signal,
        request.settings ?? DEFAULT_CHAT_RUNTIME_SETTINGS,
      );
    },
  };
}

export type ChatService = ReturnType<typeof createChatService>;
