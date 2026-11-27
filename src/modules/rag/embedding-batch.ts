import "server-only";

import { EMBEDDING_MODEL } from "@/modules/rag/ingestion-types";
import { getOpenAI } from "@/modules/shared/integrations/openai";

export type EmbeddingBatchClient = {
  create(inputs: string[]): Promise<number[][]>;
};

export function createOpenAIEmbeddingBatchClient(apiKey?: string): EmbeddingBatchClient {
  return {
    async create(inputs) {
      const response = await getOpenAI(apiKey).embeddings.create({
        model: EMBEDDING_MODEL,
        input: inputs,
      });
      return response.data.map((item) => item.embedding);
    },
  };
}

/**
 * Embeds chunks in bounded concurrent batches and verifies that the provider
 * returned exactly one vector per input. An incomplete batch fails the attempt,
 * which is retried by the queue instead of producing a half-embedded document.
 */
export async function embedTexts(
  client: EmbeddingBatchClient,
  texts: string[],
  options: { batchSize?: number; concurrency?: number } = {},
): Promise<number[][]> {
  const batchSize = Math.max(1, options.batchSize ?? 32);
  const concurrency = Math.max(1, options.concurrency ?? 3);
  const starts = Array.from(
    { length: Math.ceil(texts.length / batchSize) },
    (_, index) => index * batchSize,
  );
  const vectors: number[][] = [];

  for (let start = 0; start < starts.length; start += concurrency) {
    const results = await Promise.all(
      starts.slice(start, start + concurrency).map(async (batchStart) => {
        const batch = texts.slice(batchStart, batchStart + batchSize);
        const batchVectors = await client.create(batch);
        if (batchVectors.length !== batch.length) {
          throw new Error("The embedding provider returned an incomplete batch.");
        }
        return batchVectors;
      }),
    );
    vectors.push(...results.flat());
  }

  return vectors;
}
