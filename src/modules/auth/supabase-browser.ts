"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/modules/shared/integrations/database.types";

let browserClient: ReturnType<typeof createBrowserClient<Database>> | undefined;

export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    throw new Error("Supabase authentication is not configured. Check your web/.env.local file.");
  }

  browserClient ??= createBrowserClient<Database>(url, publishableKey);
  return browserClient;
}
