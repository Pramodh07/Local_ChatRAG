import { getAuthMode } from "@/modules/auth/auth-mode";
import { getAuthenticatedLocalAccount } from "@/modules/auth/local-session";
import { createSupabaseServerClient, getSupabaseUser } from "@/modules/auth/supabase-server";
import { testProviderConnection } from "@/modules/account/provider-connection";
import { isModelProvider } from "@/modules/account/types";
import { errorResponse, jsonError, jsonOk } from "@/modules/shared/lib/api-response";
import { isRecord } from "@/modules/shared/lib/guards";
import { readJsonBody } from "@/modules/shared/lib/request";
import { ServiceConfigurationError, UnauthenticatedError } from "@/modules/shared/lib/errors";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const authMode = getAuthMode();
    if (authMode === "local") {
      if (!(await getAuthenticatedLocalAccount())) throw new UnauthenticatedError();
    } else if (authMode === "supabase") {
      const supabase = await createSupabaseServerClient();
      if (!(await getSupabaseUser(supabase))) throw new UnauthenticatedError();
    } else {
      throw new ServiceConfigurationError("Configure authentication before testing a provider connection.");
    }

    const body = await readJsonBody(request, {
      maxBytes: 1024,
      tooLargeMessage: "Provider test request is too large.",
    });
    if (!body.ok) return jsonError(body.error, body.status);
    if (!isRecord(body.data) || !isModelProvider(body.data.provider)) {
      return jsonError("Choose a supported provider.", 400);
    }

    await testProviderConnection(body.data.provider);
    return jsonOk({ connected: true });
  } catch (error) {
    return errorResponse(error, {
      logLabel: "Testing provider connection failed",
      fallbackMessage: "The provider connection could not be tested.",
    });
  }
}
