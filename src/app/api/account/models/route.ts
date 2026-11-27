import { createAccountService } from "@/modules/account/account-service";
import { isLocalAuthEnabled } from "@/modules/auth/auth-mode";
import { getAuthenticatedLocalAccount } from "@/modules/auth/local-session";
import { errorResponse, jsonError, jsonOk } from "@/modules/shared/lib/api-response";
import { UnauthorizedError } from "@/modules/shared/lib/errors";

export const runtime = "nodejs";

const accountService = createAccountService();

export async function GET() {
  if (!isLocalAuthEnabled()) return jsonError("Local model selection is disabled.", 404);

  try {
    const account = await getAuthenticatedLocalAccount();
    if (!account) {
      throw new UnauthorizedError(
        "Model selection is available only in local development. Sign in with a local account.",
      );
    }

    return jsonOk({ providers: await accountService.getModels() });
  } catch (error) {
    return errorResponse(error, {
      logLabel: "Loading local model options failed",
      fallbackMessage: "Model options could not be loaded.",
    });
  }
}
