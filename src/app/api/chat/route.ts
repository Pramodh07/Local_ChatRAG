import { getAuthMode } from "@/modules/auth/auth-mode";
import { getAuthenticatedLocalAccount } from "@/modules/auth/local-session";
import { createSupabaseServerClient, getSupabaseUser } from "@/modules/auth/supabase-server";
import { createChatService } from "@/modules/chat/chat-service";
import { readChatRequest } from "@/modules/chat/chat-request";
import { errorResponse, jsonError, jsonOk } from "@/modules/shared/lib/api-response";
import {
  ServiceConfigurationError,
  UnauthenticatedError,
} from "@/modules/shared/lib/errors";

export const runtime = "nodejs";
export const maxDuration = 60;

const chatService = createChatService();

export async function POST(request: Request) {
  try {
    const authMode = getAuthMode();

    if (authMode === "local") {
      const account = await getAuthenticatedLocalAccount();
      if (!account) throw new UnauthenticatedError();

      const body = await readChatRequest(request);
      if (!body.ok) return jsonError(body.message, body.status);

      return jsonOk(await chatService.answerLocally(account.id, body.value, request.signal));
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

    return jsonOk(await chatService.answerWithRag(supabase, body.value, request.signal));
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });

    const localMode = getAuthMode() === "local";
    return errorResponse(error, {
      logLabel: localMode ? "Local model chat request failed" : "RAG chat request failed",
      fallbackMessage: localMode
        ? "Local model chat failed. Check the server logs and local provider setup."
        : "The RAG chat request failed. Check the server logs and Supabase setup.",
      rateLimitCheckMessage: "Chat is temporarily unavailable. Try again shortly.",
    });
  }
}
