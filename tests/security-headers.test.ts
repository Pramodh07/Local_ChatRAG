import { afterEach, describe, expect, it, vi } from "vitest";

type HeaderEntry = { key: string; value: string };

async function headerValue(key: string): Promise<string | undefined> {
  const { default: config } = await import("../next.config");
  const groups = (await config.headers?.()) ?? [];
  const entries = groups.flatMap((group) => group.headers ?? []) as HeaderEntry[];
  return entries.find((header) => header.key === key)?.value;
}

describe("next.config security hardening", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("sets baseline security headers and hides the framework banner", async () => {
    expect(await headerValue("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(await headerValue("X-Content-Type-Options")).toBe("nosniff");
    expect(await headerValue("X-Frame-Options")).toBe("DENY");
    expect(await headerValue("Permissions-Policy")).toContain("geolocation=()");

    const csp = (await headerValue("Content-Security-Policy")) ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");

    const { default: config } = await import("../next.config");
    expect(config.poweredByHeader).toBe(false);
    expect(config.allowedDevOrigins).toBeUndefined();
  });

  it("allows the configured Supabase origin as the only external connect source", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");

    const csp = (await headerValue("Content-Security-Policy")) ?? "";
    expect(csp).toContain("connect-src 'self' https://example.supabase.co wss://example.supabase.co");
  });
});
