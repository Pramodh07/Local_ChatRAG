import { createAccountService } from "@/modules/account/account-service";
import { isLocalAuthEnabled } from "@/modules/auth/auth-mode";
import { getAuthenticatedLocalAccount } from "@/modules/auth/local-session";
import { errorResponse, jsonError, jsonOk } from "@/modules/shared/lib/api-response";
import { UnauthorizedError } from "@/modules/shared/lib/errors";
import { readJsonBody } from "@/modules/shared/lib/request";

export const runtime = "nodejs";
const MAX_PREFERENCE_BYTES = 4096;

const DISABLED_MESSAGE = "Local account preferences are disabled.";
const UNAUTHORIZED_MESSAGE =
  "Local account preferences are available only in local development. Sign in with a local account.";

const accountService = createAccountService();

export async function GET() {
  if (!isLocalAuthEnabled()) return jsonError(DISABLED_MESSAGE, 404);

  try {
    const account = await getAuthenticatedLocalAccount();
    if (!account) throw new UnauthorizedError(UNAUTHORIZED_MESSAGE);

    return jsonOk(await accountService.getPreferences(account.id));
  } catch (error) {
    return errorResponse(error, {
      logLabel: "Loading local account preferences failed",
      fallbackMessage: "Account preferences could not be loaded.",
    });
  }
}

export async function PATCH(request: Request) {
  if (!isLocalAuthEnabled()) return jsonError(DISABLED_MESSAGE, 404);

  try {
    const account = await getAuthenticatedLocalAccount();
    if (!account) throw new UnauthorizedError(UNAUTHORIZED_MESSAGE);

    const body = await readJsonBody(request, {
      maxBytes: MAX_PREFERENCE_BYTES,
      tooLargeMessage: "Preference request is too large.",
    });
    if (!body.ok) return jsonError(body.error, body.status);

    return jsonOk({
      preferences: await accountService.updatePreferences(account.id, body.data),
    });
  } catch (error) {
    return errorResponse(error, {
      logLabel: "Saving local account preferences failed",
      fallbackMessage: "Account preferences could not be saved.",
    });
  }
}
