import "server-only";

import type { ModelProvider } from "@/modules/account/types";
import { listOllamaModels } from "@/modules/account/local-model-runtime";
import { ServiceConfigurationError, UpstreamError } from "@/modules/shared/lib/errors";

function providerKey(provider: ModelProvider): string {
  const key =
    provider === "openai"
      ? process.env.OPENAI_API_KEY
      : provider === "anthropic"
        ? process.env.ANTHROPIC_API_KEY
        : provider === "google"
          ? process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY
          : undefined;
  if (!key && provider !== "ollama") {
    throw new ServiceConfigurationError("Configure this provider's API key in the server environment.");
  }
  return key ?? "";
}

export async function testProviderConnection(provider: ModelProvider): Promise<void> {
  if (provider === "ollama") {
    const models = await listOllamaModels();
    if (models.length === 0) throw new ServiceConfigurationError("No Ollama models are available.");
    return;
  }

  const key = providerKey(provider);
  const endpoint =
    provider === "openai"
      ? "https://api.openai.com/v1/models"
      : provider === "anthropic"
        ? "https://api.anthropic.com/v1/models"
        : "https://generativelanguage.googleapis.com/v1beta/models";
  const headers: HeadersInit =
    provider === "openai"
      ? { Authorization: `Bearer ${key}` }
      : provider === "anthropic"
        ? { "x-api-key": key, "anthropic-version": "2023-06-01" }
        : { "x-goog-api-key": key };

  let response: Response;
  try {
    response = await fetch(endpoint, { headers, cache: "no-store", signal: AbortSignal.timeout(8000) });
  } catch {
    throw new UpstreamError("The provider could not be reached. Check your connection and try again.");
  }
  if (!response.ok) {
    throw new UpstreamError(
      response.status === 401 || response.status === 403
        ? "The provider rejected this API key. Check it and try again."
        : `The provider connection failed (HTTP ${response.status}).`,
    );
  }
}
