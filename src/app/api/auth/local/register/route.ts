import { NextResponse } from "next/server";
import { isLocalAuthEnabled } from "@/modules/auth/auth-mode";
import { NO_STORE_HEADERS } from "@/modules/shared/lib/http";
import {
  createLocalAccount,
  parseLocalAuthPayload,
  setLocalSessionCookie,
} from "@/modules/auth/local-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isLocalAuthEnabled()) {
    return NextResponse.json({ error: "Local authentication is disabled." }, { status: 404 });
  }

  const payload = await parseLocalAuthPayload(request, true);
  if (!payload || !payload.displayName) {
    return NextResponse.json(
      {
        error:
          "Enter a valid name and email. Passwords must be 8-20 characters and include uppercase, lowercase, a number, and a symbol.",
      },
      { status: 400 },
    );
  }

  try {
    const result = await createLocalAccount(payload.email, payload.displayName, payload.password);
    if (!result) {
      return NextResponse.json(
        { error: "An account could not be created. Try signing in instead." },
        { status: 409 },
      );
    }

    const response = NextResponse.json({ account: result.account }, {
      headers: NO_STORE_HEADERS,
    });
    setLocalSessionCookie(response, request.url, result.token);
    return response;
  } catch (error) {
    console.error("Local account registration failed:", error);
    return NextResponse.json({ error: "Account registration failed. Try again." }, { status: 500 });
  }
}
