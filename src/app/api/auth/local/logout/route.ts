import { NextResponse, type NextRequest } from "next/server";
import { isLocalAuthEnabled } from "@/modules/auth/auth-mode";
import {
  clearLocalSessionCookie,
  LOCAL_AUTH_COOKIE,
  revokeLocalSession,
} from "@/modules/auth/local-auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!isLocalAuthEnabled()) {
    return NextResponse.json({ error: "Local authentication is disabled." }, { status: 404 });
  }

  try {
    await revokeLocalSession(request.cookies.get(LOCAL_AUTH_COOKIE)?.value);

    const response = new NextResponse(null, { status: 204 });
    clearLocalSessionCookie(response, request.url);
    return response;
  } catch (error) {
    console.error("Local sign-out failed:", error);
    return NextResponse.json({ error: "Sign-out failed. Try again." }, { status: 500 });
  }
}
