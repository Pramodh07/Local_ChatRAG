import { getAuthMode } from "@/modules/auth/auth-mode";
import { createSupabaseServerClient, getSupabaseUser } from "@/modules/auth/supabase-server";
import { createDocumentService } from "@/modules/rag/document-service";
import { errorResponse, jsonError, jsonOk } from "@/modules/shared/lib/api-response";
import { NotFoundError, UnauthenticatedError } from "@/modules/shared/lib/errors";
import { readJsonBody } from "@/modules/shared/lib/request";

export const runtime = "nodejs";
export const maxDuration = 60;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const documentService = createDocumentService();

async function authenticate() {
  if (getAuthMode() !== "supabase") {
    throw new NotFoundError("Ingestion jobs require Supabase authentication.");
  }
  const supabase = await createSupabaseServerClient();
  const user = await getSupabaseUser(supabase);
  if (!user) throw new UnauthenticatedError();
  return { supabase, userId: user.id };
}

export async function GET(request: Request) {
  try {
    const jobId = new URL(request.url).searchParams.get("id");
    if (!jobId || !UUID_PATTERN.test(jobId)) {
      return jsonError("Choose a valid ingestion job.", 400);
    }

    const { supabase, userId } = await authenticate();
    const job = await documentService.getJob({
      jobId,
      ownerId: userId,
      supabase,
    });
    if (!job) throw new NotFoundError("Ingestion job not found.");

    return jsonOk({ job });
  } catch (error) {
    return errorResponse(error, {
      logLabel: "Loading ingestion job failed",
      fallbackMessage: "The ingestion job could not be loaded.",
    });
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, userId } = await authenticate();

    const body = await readJsonBody(request, {
      maxBytes: 2_048,
      invalidMessage: "Request body must be valid JSON.",
    });
    if (!body.ok) return jsonError(body.error, body.status);
    if (
      body.data === null ||
      typeof body.data !== "object" ||
      Array.isArray(body.data)
    ) {
      return jsonError("Request body must be a JSON object.", 400);
    }

    const jobId = (body.data as { jobId?: unknown }).jobId;
    if (jobId !== undefined && (typeof jobId !== "string" || !UUID_PATTERN.test(jobId))) {
      return jsonError("Choose a valid failed ingestion job.", 400);
    }

    let retriedJob = false;
    if (jobId) {
      retriedJob = await documentService.retryJob({
        jobId,
        ownerId: userId,
        supabase,
      });
      if (!retriedJob) {
        throw new NotFoundError("No failed ingestion job matches that request.");
      }
    }

    if (!retriedJob) {
      return jsonError("Choose a failed ingestion job to retry.", 400);
    }

    return jsonOk({ retriedJob });
  } catch (error) {
    return errorResponse(error, {
      logLabel: "Processing ingestion jobs failed",
      fallbackMessage: "Queued documents could not be processed. Try again shortly.",
    });
  }
}
