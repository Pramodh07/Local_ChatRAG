import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/modules/shared/integrations/database.types";
import { RateLimitCheckError } from "@/modules/shared/lib/errors";

export type RateLimitedAction = "chat" | "document_upload";

export async function consumeApiRateLimit(
  supabase: SupabaseClient<Database>,
  action: RateLimitedAction,
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  try {
    const { data, error } = await supabase.rpc("consume_api_rate_limit", { p_action: action });
    if (error) throw new RateLimitCheckError(error);
    const [limit] = data;
    if (
      !limit ||
      typeof limit.allowed !== "boolean" ||
      !Number.isInteger(limit.retry_after_seconds) ||
      limit.retry_after_seconds < 1
    ) {
      throw new RateLimitCheckError();
    }
    return {
      allowed: limit.allowed,
      retryAfterSeconds: limit.retry_after_seconds,
    };
  } catch (error) {
    if (error instanceof RateLimitCheckError) throw error;
    throw new RateLimitCheckError(error);
  }
}
