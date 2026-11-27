import { NextResponse } from "next/server";
import { isLocalAuthEnabled } from "@/modules/auth/auth-mode";
import { NO_STORE_HEADERS } from "@/modules/shared/lib/http";
import {
  parseLocalAuthPayload,
  setLocalSessionCookie,
  signInLocalAccount,
} from "@/modules/auth/local-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isLocalAuthEnabled()) {
    return NextResponse.json({ error: "Local authentication is disabled." }, { status: 404 });
  }

  const payload = await parseLocalAuthPayload(request, false);
  if (!payload) {
    return NextResponse.json({ error: "Enter a valid email and password." }, { status: 400 });
  }

  try {
    const result = await signInLocalAccount(payload.email, payload.password);
    if (!result) {
      return NextResponse.json({ error: "Unable to sign in with those credentials." }, { status: 401 });
    }

    const response = NextResponse.json({ account: result.account }, {
      headers: NO_STORE_HEADERS,
    });
    setLocalSessionCookie(response, request.url, result.token);
    return response;
  } catch (error) {
    console.error("Local sign-in failed:", error);
    return NextResponse.json({ error: "Sign-in failed. Try again." }, { status: 500 });
  }
}
