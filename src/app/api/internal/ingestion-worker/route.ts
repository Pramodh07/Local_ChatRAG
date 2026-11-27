import { timingSafeEqual } from "node:crypto";
import { createDocumentService } from "@/modules/rag/document-service";
import { createSupabaseServiceClient } from "@/modules/shared/integrations/supabase-service-client";
import { errorResponse, jsonError, jsonOk } from "@/modules/shared/lib/api-response";
import { ServiceConfigurationError } from "@/modules/shared/lib/errors";

export const runtime = "nodejs";
export const maxDuration = 60;

const documentService = createDocumentService();

function isAuthorized(request: Request, secret: string): boolean {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer (.+)$/.exec(authorization);
  if (!match?.[1]) return false;

  const provided = Buffer.from(match[1]);
  const expected = Buffer.from(secret);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export async function POST(request: Request) {
  try {
    const secret = process.env.ATLAS_INGESTION_WORKER_SECRET;
    if (!secret || secret.length < 32) {
      throw new ServiceConfigurationError(
        "Set ATLAS_INGESTION_WORKER_SECRET to a random value of at least 32 characters.",
      );
    }
    if (!isAuthorized(request, secret)) {
      return jsonError("Unauthorized.", 401);
    }

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      throw new ServiceConfigurationError(
        "Set OPENAI_API_KEY on the server to enable document ingestion.",
      );
    }

    const result = await documentService.processJobs({
      supabase: createSupabaseServiceClient(),
      apiKey,
      limit: 1,
    });
    return jsonOk(result);
  } catch (error) {
    return errorResponse(error, {
      logLabel: "Background ingestion worker failed",
      fallbackMessage: "Queued document processing failed.",
    });
  }
}
