export type AuthProvider = "local" | "supabase";
export type AuthMode = AuthProvider | "unconfigured";
export type DatabaseProvider = "local" | "postgres" | "supabase";

export type ProviderConfig =
  | {
      configured: true;
      auth: AuthProvider;
      database: DatabaseProvider;
    }
  | {
      configured: false;
      auth: "unconfigured";
      database: "unconfigured";
      reason: string;
    };

export type ProviderEnvironment = {
  NODE_ENV?: string;
  AUTH_MODE?: string;
  AUTH_PROVIDER?: string;
  DATABASE_PROVIDER?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
};

function isAuthProvider(value: string): value is AuthProvider {
  return value === "local" || value === "supabase";
}

function isDatabaseProvider(value: string): value is DatabaseProvider {
  return value === "local" || value === "postgres" || value === "supabase";
}

function unconfigured(reason: string): ProviderConfig {
  return { configured: false, auth: "unconfigured", database: "unconfigured", reason };
}

/**
 * Resolves the auth and database providers independently, while keeping the
 * legacy `AUTH_MODE` switch working during the transition.
 *
 * Supported pairings:
 * - `local` auth + `local` JSON data store (development only)
 * - `local` auth + `postgres` embedded PGlite data store (development only)
 * - `supabase` auth + `supabase` data store
 *
 * Unsupported pairings fail closed with a reason instead of silently mixing
 * identities that belong to different systems.
 */
export function resolveProviderConfig(env: ProviderEnvironment): ProviderConfig {
  const isDevelopment = env.NODE_ENV === "development";
  const hasSupabaseUrl = Boolean(env.NEXT_PUBLIC_SUPABASE_URL);
  const hasSupabaseKey = Boolean(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  const hasSupabaseConfig = hasSupabaseUrl && hasSupabaseKey;

  const requestedAuth = env.AUTH_PROVIDER ?? env.AUTH_MODE;
  let auth: AuthProvider;

  if (requestedAuth !== undefined) {
    if (!isAuthProvider(requestedAuth)) {
      return unconfigured(
        `AUTH_PROVIDER must be "local" or "supabase"; received "${requestedAuth}".`,
      );
    }
    if (requestedAuth === "local" && !isDevelopment) {
      return unconfigured("Local authentication is available only in development.");
    }
    if (requestedAuth === "supabase" && !hasSupabaseConfig) {
      return unconfigured(
        "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to use Supabase authentication.",
      );
    }
    auth = requestedAuth;
  } else if (hasSupabaseConfig) {
    auth = "supabase";
  } else if (hasSupabaseUrl || hasSupabaseKey) {
    return unconfigured(
      "Set both NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, or neither.",
    );
  } else if (isDevelopment) {
    auth = "local";
  } else {
    return unconfigured(
      "Configure Supabase, or set AUTH_PROVIDER=local in development.",
    );
  }

  const requestedDatabase = env.DATABASE_PROVIDER;
  let database: DatabaseProvider;

  if (requestedDatabase !== undefined) {
    if (!isDatabaseProvider(requestedDatabase)) {
      return unconfigured(
        `DATABASE_PROVIDER must be "local", "postgres", or "supabase"; received "${requestedDatabase}".`,
      );
    }
    database = requestedDatabase;
  } else {
    database = auth === "supabase" ? "supabase" : "local";
  }

  if (auth === "local" && database === "supabase") {
    return unconfigured(
      "AUTH_PROVIDER=local cannot use DATABASE_PROVIDER=supabase because Supabase row-level security requires a Supabase identity.",
    );
  }
  if (auth === "supabase" && database !== "supabase") {
    return unconfigured(
      "AUTH_PROVIDER=supabase requires DATABASE_PROVIDER=supabase; Supabase identities are not valid local store owners.",
    );
  }
  if (database === "postgres" && !isDevelopment) {
    return unconfigured(
      "DATABASE_PROVIDER=postgres uses the embedded local runtime and is available only in development.",
    );
  }

  return { configured: true, auth, database };
}

export function getProviderConfig(): ProviderConfig {
  return resolveProviderConfig(process.env);
}

export function getAuthMode(): AuthMode {
  const config = getProviderConfig();
  return config.configured ? config.auth : "unconfigured";
}

export function getAuthProvider(): AuthProvider | null {
  const config = getProviderConfig();
  return config.configured ? config.auth : null;
}

export function getDatabaseProvider(): DatabaseProvider | null {
  const config = getProviderConfig();
  return config.configured ? config.database : null;
}

export function isLocalAuthEnabled(): boolean {
  return getAuthMode() === "local";
}
