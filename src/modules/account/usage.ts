import type { UsageBucket, UsageTotals } from "@/modules/account/types";

export function sumUsageBuckets(buckets: UsageBucket[]): UsageTotals {
  return buckets.reduce<UsageTotals>(
    (totals, bucket) => ({
      requests: totals.requests + bucket.requests,
      inputTokens: totals.inputTokens + bucket.inputTokens,
      outputTokens: totals.outputTokens + bucket.outputTokens,
      estimatedCostUsd: totals.estimatedCostUsd + bucket.estimatedCostUsd,
      costEstimateComplete: totals.costEstimateComplete && bucket.costEstimateComplete,
    }),
    {
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      costEstimateComplete: true,
    },
  );
}
