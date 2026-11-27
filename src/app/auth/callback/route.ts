import { NextResponse } from "next/server";
import { getAuthMode } from "@/modules/auth/auth-mode";
import { createSupabaseServerClient } from "@/modules/auth/supabase-server";

export async function GET(request: Request) {
  if (getAuthMode() !== "supabase") {
    return NextResponse.json({ error: "Supabase authentication is disabled." }, { status: 404 });
  }

  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.redirect(new URL("/?auth=confirmation-error", requestUrl));
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    return NextResponse.redirect(new URL("/", requestUrl));
  } catch (error) {
    console.error("Email confirmation failed:", error);
    return NextResponse.redirect(new URL("/?auth=confirmation-error", requestUrl));
  }
}
