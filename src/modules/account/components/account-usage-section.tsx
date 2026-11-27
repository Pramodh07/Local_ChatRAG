import { CreditCard, Table } from "@/modules/shared/components/icons";
import { LoadingState, LocalOnlyNotice } from "@/modules/account/components/account-ui";
import { formatCost, formatTokens } from "@/modules/account/components/account-dashboard-helpers";
import type { UsageBucket } from "@/modules/account/types";
import { sumUsageBuckets } from "@/modules/account/usage";
import { Card, CardHeader } from "@/modules/shared/components/ui/card";
import { cn } from "@/modules/shared/lib/utils";

type AccountUsageSectionProps = {
  usage: UsageBucket[];
  localMode: boolean;
  loading: boolean;
};

function UsageStat({
  label,
  value,
  hint,
  accent = false,
}: {
  label: string;
  value: string;
  hint: string;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-4",
        accent
          ? "border-accent/25 bg-accent-soft"
          : "border-line bg-[var(--surface-solid)] shadow-[var(--shadow-soft)]",
      )}
    >
      <p className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-faint">{label}</p>
      <p className="mt-1.5 text-[21px] font-semibold tracking-[-0.02em] text-ink">{value}</p>
      <p className="mt-1 text-[10.5px] leading-4 text-muted">{hint}</p>
    </div>
  );
}

export function AccountUsageSection({ usage, localMode, loading }: AccountUsageSectionProps) {
  if (!localMode) return <LocalOnlyNotice />;
  if (loading) return <LoadingState />;

  const totals = sumUsageBuckets(usage);
  const totalTokens = totals.inputTokens + totals.outputTokens;

  return (
    <div className="space-y-5">
      <div className="grid gap-2.5 sm:grid-cols-3">
        <UsageStat
          label="Requests"
          value={formatTokens(totals.requests)}
          hint="Chat requests recorded in this workspace."
        />
        <UsageStat
          label="Tokens"
          value={formatTokens(totalTokens)}
          hint={`${formatTokens(totals.inputTokens)} in · ${formatTokens(totals.outputTokens)} out`}
        />
        <UsageStat
          accent
          label="Estimated cost"
          value={
            totals.costEstimateComplete
              ? formatCost(totals.estimatedCostUsd)
              : `${formatCost(totals.estimatedCostUsd)}+`
          }
          hint="Based on standard model rates, not invoices."
        />
      </div>

      <Card>
        <div className="p-5 sm:p-6">
          <CardHeader
            icon={<Table size={15} />}
            title="Daily breakdown"
            description="Input and output token counts come from provider responses."
          />

          {usage.length ? (
            <div className="scroll-slim mt-4 max-h-[28rem] divide-y divide-line">
              {usage.map((bucket) => (
                <div
                  key={`${bucket.date}-${bucket.provider}-${bucket.model}`}
                  className="grid gap-1.5 py-3 sm:grid-cols-[1fr_auto] sm:items-center"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[12.5px] font-medium text-ink">{bucket.model}</p>
                    <p className="text-[11px] text-muted">
                      {new Date(`${bucket.date}T12:00:00`).toLocaleDateString()} · {bucket.provider} ·{" "}
                      {bucket.requests} request{bucket.requests === 1 ? "" : "s"}
                    </p>
                  </div>
                  <div className="text-left text-[11px] leading-5 text-muted sm:text-right">
                    <p className="font-mono tabular-nums">
                      {formatTokens(bucket.inputTokens)} in · {formatTokens(bucket.outputTokens)} out
                    </p>
                    <p className="font-mono tabular-nums">
                      {bucket.costEstimateComplete
                        ? formatCost(bucket.estimatedCostUsd)
                        : `${formatCost(bucket.estimatedCostUsd)}+ estimated`}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-4 rounded-xl border border-dashed border-line px-5 py-10 text-center">
              <span className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-raised text-faint">
                <CreditCard size={17} />
              </span>
              <p className="text-[12.5px] font-medium text-ink">No usage yet</p>
              <p className="mx-auto mt-1 max-w-xs text-[11.5px] leading-5 text-muted">
                Choose a provider and send a message to start tracking requests and tokens.
              </p>
            </div>
          )}

          <p className="mt-5 border-t border-line pt-4 text-[10.5px] leading-5 text-faint">
            Costs are estimates from token counts and standard model rates, not provider invoices.
            Cached or internal tokens, discounts, taxes, and regional pricing may differ. Ollama
            reports $0 provider cost; local hardware and electricity are not included.
          </p>
        </div>
      </Card>
    </div>
  );
}
