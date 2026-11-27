import type { NextConfig } from "next";

// The inline theme script in src/app/layout.tsx runs before paint, so script-src
// must permit inline scripts. All other sources are restricted to the app origin;
// browser-side Supabase traffic is the only external connection the client makes.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const connectSources = ["'self'"];
if (supabaseUrl) {
  try {
    const origin = new URL(supabaseUrl).origin;
    connectSources.push(origin, origin.replace(/^https:/, "wss:"));
  } catch {
    // An invalid URL fails closed: no external connect source is added.
  }
}

// React/Next.js dev tooling uses eval() for source maps and the error overlay.
// Keep it out of production CSP.
const scriptSources = ["'self'", "'unsafe-inline'"];
if (process.env.NODE_ENV !== "production") scriptSources.push("'unsafe-eval'");

const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src ${scriptSources.join(" ")}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src ${connectSources.join(" ")}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // PGlite ships WebAssembly and extension assets that must stay outside the
  // server bundle. It is only loaded when DATABASE_PROVIDER=postgres.
  serverExternalPackages: ["@electric-sql/pglite", "@electric-sql/pglite-pgvector"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          ...(process.env.NODE_ENV === "production"
            ? [
                {
                  key: "Strict-Transport-Security",
                  value: "max-age=31536000; includeSubDomains",
                },
              ]
            : []),
        ],
      },
    ];
  },
};

export default nextConfig;
