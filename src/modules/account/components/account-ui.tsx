import { Database } from "@/modules/shared/components/icons";
import { Card } from "@/modules/shared/components/ui/card";

export function LocalOnlyNotice() {
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-accent-soft text-accent-ink">
          <Database size={15} />
        </span>
        <div>
          <h2 className="text-[13.5px] font-semibold text-ink">Available in local development</h2>
          <p className="mt-1 text-[12.5px] leading-6 text-muted">
            Model preferences and usage tracking are available with local development auth. Run the
            app with{" "}
            <code className="rounded-md border border-line bg-raised px-1.5 py-0.5 font-mono text-[11px] text-ink">
              AUTH_MODE=local
            </code>{" "}
            to use these features.
          </p>
        </div>
      </div>
    </Card>
  );
}

export function LoadingState() {
  return (
    <Card className="p-5 sm:p-6" role="status" aria-live="polite">
      <div className="space-y-3">
        <div className="skeleton h-3.5 w-1/3" />
        <div className="skeleton h-3 w-2/3" />
        <div className="skeleton h-10 w-full" />
      </div>
      <span className="sr-only">Loading account data…</span>
    </Card>
  );
}
