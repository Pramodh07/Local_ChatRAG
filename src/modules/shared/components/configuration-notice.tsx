import { Logo, Settings } from "@/modules/shared/components/icons";

export function ConfigurationNotice() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-5">
      <div className="w-full max-w-md rounded-[var(--radius-container)] border border-line bg-surface-solid p-6">
        <div className="flex items-center gap-2.5">
          <Logo className="h-8 w-8" />
          <span className="text-sm font-semibold tracking-[-0.02em]">Atlas</span>
        </div>
        <div className="mt-5 flex h-9 w-9 items-center justify-center rounded-[10px] bg-warn/10 text-warn">
          <Settings size={17} />
        </div>
        <h1 className="mt-3 text-[17px] font-semibold tracking-[-0.02em]">Configuration required</h1>
        <p className="mt-1.5 text-[12.5px] leading-6 text-muted">
          Set{" "}
          <code className="rounded-md border border-line bg-raised px-1.5 py-0.5 font-mono text-[11px] text-ink">
            AUTH_MODE=local
          </code>{" "}
          during development, or configure Supabase and set{" "}
          <code className="rounded-md border border-line bg-raised px-1.5 py-0.5 font-mono text-[11px] text-ink">
            AUTH_MODE=supabase
          </code>
          .
        </p>
      </div>
    </main>
  );
}
