import { getAuthMode } from "@/modules/auth/auth-mode";
import { getAuthenticatedLocalAccount } from "@/modules/auth/local-session";
import { createSupabaseServerClient, getSupabaseUser } from "@/modules/auth/supabase-server";
import { createDocumentService } from "@/modules/rag/document-service";
import { readDocumentUpload } from "@/modules/rag/upload-request";
import { errorResponse, jsonError, jsonOk } from "@/modules/shared/lib/api-response";
import {
  ServiceConfigurationError,
  UnauthenticatedError,
} from "@/modules/shared/lib/errors";
import { readDocumentChunkSize } from "@/modules/chat/runtime-settings";

export const runtime = "nodejs";
export const maxDuration = 60;

const documentService = createDocumentService();

export async function GET() {
  try {
    if (getAuthMode() !== "supabase") {
      return jsonError("Document management requires Supabase authentication.", 503);
    }

    const supabase = await createSupabaseServerClient();
    const user = await getSupabaseUser(supabase);
    if (!user) throw new UnauthenticatedError();

    return jsonOk({
      documents: await documentService.list({ ownerId: user.id, supabase }),
    });
  } catch (error) {
    return errorResponse(error, {
      logLabel: "Loading documents failed",
      fallbackMessage: "Documents could not be loaded. Try again.",
    });
  }
}

export async function DELETE(request: Request) {
  try {
    if (getAuthMode() !== "supabase") {
      return jsonError("Document management requires Supabase authentication.", 503);
    }

    const documentId = new URL(request.url).searchParams.get("id");
    if (!documentId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(documentId)) {
      return jsonError("Choose a valid document to delete.", 400);
    }

    const supabase = await createSupabaseServerClient();
    const user = await getSupabaseUser(supabase);
    if (!user) throw new UnauthenticatedError();

    await documentService.delete({ documentId, ownerId: user.id, supabase });
    return jsonOk({ deleted: true });
  } catch (error) {
    return errorResponse(error, {
      logLabel: "Deleting document failed",
      fallbackMessage: "The document could not be deleted. Try again.",
    });
  }
}

export async function POST(request: Request) {
  try {
    const authMode = getAuthMode();

    if (authMode === "local") {
      const account = await getAuthenticatedLocalAccount();
      if (!account) throw new UnauthenticatedError();
      return jsonError(
        "Local auth tests sign-in only. Configure Supabase and OpenAI to index documents.",
        503,
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

    // Check the account budget before reading the multipart body. This keeps an
    // exhausted account from making the server buffer a 4 MB upload (SEC-11).
    await documentService.checkUploadRateLimit({ supabase });

    const upload = await readDocumentUpload(request);
    if (!upload.ok) return jsonError(upload.message, upload.status);

    const result = await documentService.upload({
      file: upload.value,
      ownerId: user.id,
      supabase,
      chunkSize: readDocumentChunkSize(request),
    });

    return jsonOk({ document: result }, { status: 202 });
  } catch (error) {
    return errorResponse(error, {
      logLabel: "Document upload failed",
      fallbackMessage: "The upload could not be queued. Check the server logs and Supabase setup.",
      rateLimitCheckMessage: "Document uploads are temporarily unavailable. Try again shortly.",
    });
  }
}
