import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/modules/shared/integrations/database.generated";
import { ServiceConfigurationError } from "@/modules/shared/lib/errors";

export function createSupabaseServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new ServiceConfigurationError(
      "The ingestion worker requires NEXT_PUBLIC_SUPABASE_URL and server-only SUPABASE_SERVICE_ROLE_KEY configuration.",
    );
  }

  return createClient<Database>(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}
