import { getProviderConfig } from "@/modules/shared/config/providers";
import { jsonOk } from "@/modules/shared/lib/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Liveness/readiness probe. Reports only non-secret configuration state so it
 * can be called by uptime monitors without exposing credentials.
 */
export function GET() {
  const config = getProviderConfig();
  return jsonOk({
    status: config.configured ? "ok" : "unconfigured",
    authProvider: config.auth,
    databaseProvider: config.database,
    ...(config.configured ? {} : { reason: config.reason }),
    timestamp: new Date().toISOString(),
  });
}
