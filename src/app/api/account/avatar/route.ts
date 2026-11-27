import { parseAvatarRequest } from "@/modules/account/avatar-request";
import { createAvatarService } from "@/modules/account/avatar-service";
import { errorResponse, jsonError, jsonOk } from "@/modules/shared/lib/api-response";
import { AppError } from "@/modules/shared/lib/errors";

export const runtime = "nodejs";

const avatarService = createAvatarService();

function assertConfigured(): void {
  if (avatarService.isConfigured()) return;
  throw new AppError("Auth is unconfigured.", {
    status: 400,
    code: "auth_unconfigured",
    expose: true,
  });
}

export async function GET() {
  try {
    return jsonOk(await avatarService.getAvatar());
  } catch (error) {
    return errorResponse(error, {
      logLabel: "Loading the account avatar failed",
      fallbackMessage: "Could not load the account avatar.",
    });
  }
}

export async function POST(request: Request) {
  try {
    assertConfigured();

    const parsed = await parseAvatarRequest(request);
    if (!parsed.ok) return jsonError(parsed.message, parsed.status);

    return jsonOk(await avatarService.updateAvatar(parsed.value));
  } catch (error) {
    return errorResponse(error, {
      logLabel: "Updating the account avatar failed",
      fallbackMessage: "Could not update the account avatar.",
    });
  }
}

export async function DELETE() {
  try {
    assertConfigured();
    return jsonOk(await avatarService.updateAvatar(null));
  } catch (error) {
    return errorResponse(error, {
      logLabel: "Clearing the account avatar failed",
      fallbackMessage: "Could not update the account avatar.",
    });
  }
}
