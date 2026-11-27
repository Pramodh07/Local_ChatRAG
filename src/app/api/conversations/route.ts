import { getProviderConfig, type DatabaseProvider } from "@/modules/auth/auth-mode";
import { getCurrentAccount } from "@/modules/auth/current-account";
import { createSupabaseServerClient } from "@/modules/auth/supabase-server";
import {
  loadConversations,
  localConversationRepository,
  saveConversationUpdate,
  type ConversationRepository,
} from "@/modules/chat/conversation-service";
import { createPgliteConversationRepository } from "@/modules/chat/pglite-conversation-repository";
import { createSupabaseConversationRepository } from "@/modules/chat/supabase-conversation-repository";
import { errorResponse, jsonError, jsonOk } from "@/modules/shared/lib/api-response";
import { UnauthorizedError } from "@/modules/shared/lib/errors";
import { readJsonBody } from "@/modules/shared/lib/request";

export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
const DISABLED_MESSAGE = "Conversation storage is disabled.";
const LOAD_UNAUTHORIZED_MESSAGE = "Sign in to load your conversations.";
const SAVE_UNAUTHORIZED_MESSAGE = "Sign in to save your conversations.";

async function repositoryFor(database: DatabaseProvider): Promise<ConversationRepository> {
  if (database === "supabase") {
    return createSupabaseConversationRepository(await createSupabaseServerClient());
  }
  if (database === "postgres") {
    return createPgliteConversationRepository();
  }
  return localConversationRepository;
}

export async function GET(request?: Request) {
  const config = getProviderConfig();
  if (!config.configured) return jsonError(DISABLED_MESSAGE, 404);

  try {
    const session = await getCurrentAccount();
    if (!session) throw new UnauthorizedError(LOAD_UNAUTHORIZED_MESSAGE);

    const repository = await repositoryFor(config.database);
    const conversationId = request ? new URL(request.url).searchParams.get("id") : null;
    if (conversationId) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(conversationId)) {
        return jsonError("Choose a valid conversation to load.", 400);
      }
      const messages = await repository.listMessages(session.account.id, conversationId);
      return jsonOk({ messages });
    }

    const conversations = await loadConversations(repository, session.account.id);
    return jsonOk({
      conversations: conversations.map((conversation) => ({ ...conversation, messages: [] })),
    });
  } catch (error) {
    return errorResponse(error, {
      logLabel: "Loading conversations failed",
      fallbackMessage: "Chat history could not be loaded.",
    });
  }
}

export async function POST(request: Request) {
  const config = getProviderConfig();
  if (!config.configured) return jsonError(DISABLED_MESSAGE, 404);

  try {
    const session = await getCurrentAccount();
    if (!session) throw new UnauthorizedError(SAVE_UNAUTHORIZED_MESSAGE);

    const body = await readJsonBody(request, {
      maxBytes: MAX_REQUEST_BYTES,
      tooLargeMessage: "The conversation update is too large to save.",
    });
    if (!body.ok) return jsonError(body.error, body.status);

    const repository = await repositoryFor(config.database);
    const saved = await saveConversationUpdate(repository, session.account.id, body.data);
    return jsonOk({ saved });
  } catch (error) {
    return errorResponse(error, {
      logLabel: "Saving conversation changes failed",
      fallbackMessage: "Conversation changes could not be saved.",
    });
  }
}

export async function DELETE(request: Request) {
  const config = getProviderConfig();
  if (!config.configured) return jsonError(DISABLED_MESSAGE, 404);

  try {
    const session = await getCurrentAccount();
    if (!session) throw new UnauthorizedError(SAVE_UNAUTHORIZED_MESSAGE);

    const conversationId = new URL(request.url).searchParams.get("id");
    if (!conversationId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(conversationId)) {
      return jsonError("Choose a valid conversation to delete.", 400);
    }

    const repository = await repositoryFor(config.database);
    await repository.delete(session.account.id, conversationId);
    return jsonOk({ deleted: true });
  } catch (error) {
    return errorResponse(error, {
      logLabel: "Deleting conversation failed",
      fallbackMessage: "The conversation could not be deleted.",
    });
  }
}

export async function PUT(request: Request) {
  const config = getProviderConfig();
  if (!config.configured) return jsonError(DISABLED_MESSAGE, 404);

  try {
    const session = await getCurrentAccount();
    if (!session) throw new UnauthorizedError(SAVE_UNAUTHORIZED_MESSAGE);

    const body = await readJsonBody(request, {
      maxBytes: MAX_REQUEST_BYTES,
      tooLargeMessage: "The conversation update is too large to save.",
    });
    if (!body.ok) return jsonError(body.error, body.status);
    if (
      typeof body.data !== "object" ||
      body.data === null ||
      !("ownerId" in body.data) ||
      body.data.ownerId !== session.account.id ||
      !("conversations" in body.data) ||
      !Array.isArray(body.data.conversations) ||
      body.data.conversations.length !== 0
    ) {
      return jsonError("The conversation list contains invalid data.", 400);
    }

    const repository = await repositoryFor(config.database);
    await repository.deleteAll(session.account.id);
    return jsonOk({ deleted: true });
  } catch (error) {
    return errorResponse(error, {
      logLabel: "Deleting conversations failed",
      fallbackMessage: "The conversations could not be deleted.",
    });
  }
}
