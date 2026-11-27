import { getAuthMode } from "@/modules/auth/auth-mode";
import { getAuthenticatedLocalAccount } from "@/modules/auth/local-session";
import { createSupabaseServerClient, getSupabaseUser } from "@/modules/auth/supabase-server";
import { readChatRequest, type ChatRequest } from "@/modules/chat/chat-request";
import type { ChatHistoryTurn, Citation } from "@/modules/chat/types";
import { getLocalAccountPreferences } from "@/modules/account/local-account-store";
import { estimateModelCostUsd, isCatalogueModel } from "@/modules/account/model-catalogue";
import {
  estimateStreamTokens,
  streamLocalModelAnswer,
  type StreamStats,
} from "@/modules/account/model-stream";
import {
  buildRagCompletion,
  buildRagSystemPrompt,
  extractCitedSources,
  NO_DOCUMENTS_ANSWER,
} from "@/modules/rag/answer-question";
import { createSupabaseRagRepository } from "@/modules/rag/rag-repository";
import { consumeApiRateLimit } from "@/modules/shared/integrations/api-rate-limit";
import { errorResponse, jsonError } from "@/modules/shared/lib/api-response";
import {
  AppError,
  ConflictError,
  RateLimitExceededError,
  ServiceConfigurationError,
  UnauthenticatedError,
  UpstreamError,
} from "@/modules/shared/lib/errors";
import { logStructured } from "@/modules/shared/lib/logger";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/modules/shared/integrations/database.types";
import type { ModelProvider } from "@/modules/account/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export type ChatStreamFrame =
  | { type: "delta"; text: string }
  | {
      type: "result";
      answer: string;
      citations: Citation[];
      tokens: number;
      usage?: {
        provider: string;
        model: string;
        inputTokens: number;
        outputTokens: number;
        estimatedCostUsd: number | null;
      };
    }
  | { type: "error"; message: string };

type StreamContext = {
  body: ChatRequest;
  provider: ModelProvider;
  model: string;
  repository?: ReturnType<typeof createSupabaseRagRepository>;
  supabase?: SupabaseClient<Database>;
};

const STREAM_HEADERS: Record<string, string> = {
  "Content-Type": "application/x-ndjson; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  "X-Accel-Buffering": "no",
};

function streamErrorMessage(error: unknown): string {
  if (error instanceof AppError && error.expose) return error.message;
  if (error instanceof Error && /^(Set|Add) /.test(error.message)) return error.message;
  return "The response could not be generated. Check the server logs and try again.";
}

function createNdjsonStream(context: StreamContext, request: Request): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const stats: StreamStats = { inputTokens: 0, outputTokens: 0 };

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let finished = false;
      const send = (frame: ChatStreamFrame) => {
        if (finished || request.signal.aborted) return;
        controller.enqueue(encoder.encode(`${JSON.stringify(frame)}\n`));
      };

      try {
        const { body, provider, model } = context;
        let messages: ChatHistoryTurn[];
        let availableCitations: Citation[] = [];
        let systemPrompt: string | undefined;

        if (context.repository && context.supabase) {
          const built = await buildRagCompletion(
            body.message,
            body.history,
            context.repository,
            body.settings,
            request.signal,
          );
          if (built.chunks.length === 0) {
            send({ type: "delta", text: NO_DOCUMENTS_ANSWER });
            send({
              type: "result",
              answer: NO_DOCUMENTS_ANSWER,
              citations: [],
              tokens: 0,
              usage: {
                provider,
                model,
                inputTokens: 0,
                outputTokens: 0,
                estimatedCostUsd: null,
              },
            });
            return;
          }
          messages = built.messages;
          availableCitations = built.citations;
          systemPrompt = buildRagSystemPrompt(built.chunks.length);
        } else {
          messages = [...body.history, { role: "user", content: body.message }];
        }

        // The final user turn carries the question (and, for RAG, the document
        // context), so it is passed as `message` rather than duplicated.
        const finalTurn = messages[messages.length - 1];
        const generationMessage = finalTurn?.role === "user" ? finalTurn.content : body.message;
        const generationHistory = finalTurn ? messages.slice(0, -1) : messages;

        let answer = "";
        for await (const text of streamLocalModelAnswer({
          provider,
          model,
          message: generationMessage,
          history: generationHistory,
          signal: request.signal,
          settings: body.settings,
          systemPrompt,
          stats,
        })) {
          answer += text;
          send({ type: "delta", text });
        }
        if (!answer.trim()) throw new UpstreamError("The selected model returned an empty response.");

        send({
          type: "result",
          answer,
          citations: extractCitedSources(answer, availableCitations),
          tokens:
            stats.inputTokens + stats.outputTokens ||
            (estimateStreamTokens(answer) > 0 ? estimateStreamTokens(answer) : 0),
          usage: {
            provider,
            model,
            inputTokens: stats.inputTokens,
            outputTokens: stats.outputTokens,
            estimatedCostUsd: estimateModelCostUsd(
              provider,
              model,
              stats.inputTokens,
              stats.outputTokens,
            ),
          },
        });
      } catch (error) {
        if (!request.signal.aborted) {
          logStructured("error", "Chat stream generation failed", {
            error: error instanceof Error ? error.message : error,
          });
          send({ type: "error", message: streamErrorMessage(error) });
        }
      } finally {
        finished = true;
        try {
          controller.close();
        } catch {
          // The client may have disconnected before the final frame.
        }
      }
    },
  });
}

export async function POST(request: Request) {
  try {
    if (request.signal.aborted) return new Response(null, { status: 499 });

    const authMode = getAuthMode();

    if (authMode === "local") {
      const account = await getAuthenticatedLocalAccount();
      if (!account) throw new UnauthenticatedError();

      const body = await readChatRequest(request);
      if (!body.ok) return jsonError(body.message, body.status);

      const preferences = await getLocalAccountPreferences(account.id);
      if (!isCatalogueModel(preferences.provider, preferences.model)) {
        throw new ConflictError(
          "The saved model selection is invalid. Choose a supported model in Models.",
        );
      }

      return new Response(
        createNdjsonStream(
          { body: body.value, provider: preferences.provider, model: preferences.model },
          request,
        ),
        { status: 200, headers: STREAM_HEADERS },
      );
    }

    if (authMode !== "supabase") {
      throw new ServiceConfigurationError(
        "Set AUTH_MODE=local for login testing or configure Supabase and set AUTH_MODE=supabase.",
      );
    }

    const supabase = await createSupabaseServerClient();
    const user = await getSupabaseUser(supabase);
    if (!user) throw new UnauthenticatedError();

    const body = await readChatRequest(request);
    if (!body.ok) return jsonError(body.message, body.status);

    const rateLimit = await consumeApiRateLimit(supabase, "chat");
    if (!rateLimit.allowed) {
      throw new RateLimitExceededError(
        "Chat request limit reached. Please wait before trying again.",
        rateLimit.retryAfterSeconds,
      );
    }

    return new Response(
      createNdjsonStream(
        {
          body: body.value,
          provider: body.value.provider ?? "openai",
          model: body.value.model ?? "gpt-4.1-mini",
          repository: createSupabaseRagRepository(supabase),
          supabase,
        },
        request,
      ),
      { status: 200, headers: STREAM_HEADERS },
    );
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });

    const localMode = getAuthMode() === "local";
    return errorResponse(error, {
      logLabel: localMode ? "Local model chat stream failed" : "RAG chat stream failed",
      fallbackMessage: localMode
        ? "Local model chat failed. Check the server logs and local provider setup."
        : "The RAG chat request failed. Check the server logs and Supabase setup.",
      rateLimitCheckMessage: "Chat is temporarily unavailable. Try again shortly.",
    });
  }
}
