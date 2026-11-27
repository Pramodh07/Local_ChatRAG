import { NextResponse } from "next/server";
import { isStrongPassword } from "@/modules/auth/validation";
import { isLocalAuthEnabled } from "@/modules/auth/auth-mode";
import { getLocalSessionToken } from "@/modules/auth/local-session";
import {
  changeLocalPassword,
  setLocalSessionCookie,
} from "@/modules/auth/local-auth";
import { isRecord } from "@/modules/shared/lib/guards";
import { NO_STORE_HEADERS } from "@/modules/shared/lib/http";
import { readJsonBody } from "@/modules/shared/lib/request";

export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 16_384;

export async function POST(request: Request) {
  if (!isLocalAuthEnabled()) {
    return NextResponse.json({ error: "Local authentication is disabled." }, { status: 404 });
  }

  const body = await readJsonBody(request, {
    maxBytes: MAX_REQUEST_BYTES,
    tooLargeMessage: "Password request is too large.",
  });
  if (!body.ok) {
    return NextResponse.json({ error: body.error }, { status: body.status });
  }

  const payload = body.data;
  if (
    !isRecord(payload) ||
    typeof payload.currentPassword !== "string" ||
    typeof payload.newPassword !== "string" ||
    payload.currentPassword.length < 8 ||
    payload.currentPassword.length > 128 ||
    !isStrongPassword(payload.newPassword) ||
    payload.newPassword === payload.currentPassword
  ) {
    return NextResponse.json(
      { error: "Enter your current password and a different new password that meets every requirement." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const token = await getLocalSessionToken();
    const result = await changeLocalPassword(token, payload.currentPassword, payload.newPassword);
    if (!result) {
      return NextResponse.json(
        { error: "Your current password could not be verified. Check it and try again." },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }

    const response = NextResponse.json(
      { account: result.account },
      { headers: NO_STORE_HEADERS },
    );
    setLocalSessionCookie(response, request.url, result.token);
    return response;
  } catch (error) {
    console.error("Local password update failed:", error);
    return NextResponse.json(
      { error: "Password could not be updated. Try again." },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
