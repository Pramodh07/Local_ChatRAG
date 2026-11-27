import "server-only";

import OpenAI from "openai";
import { ServiceConfigurationError } from "@/modules/shared/lib/errors";

let openAIClient: OpenAI | undefined;

export function getOpenAI(providedApiKey?: string): OpenAI {
  const apiKey = providedApiKey?.trim() || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new ServiceConfigurationError(
      "Add an OpenAI API key in Settings or set OPENAI_API_KEY in your web/.env.local file.",
    );
  }

  if (providedApiKey?.trim()) return new OpenAI({ apiKey });
  openAIClient ??= new OpenAI({ apiKey });
  return openAIClient;
}

export async function createEmbedding(
  text: string,
  signal?: AbortSignal,
  apiKey?: string,
): Promise<number[]> {
  const response = await getOpenAI(apiKey).embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  }, { signal });
  return response.data[0].embedding;
}
