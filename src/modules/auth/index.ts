// Domain types
export * from "./types";
export * from "./validation";

// Components
export { AuthScreen } from "./components/auth-screen";
export { AccountMenu } from "./components/account-menu";
export { UserAvatar } from "./components/user-avatar";

// Browser client
export { createSupabaseBrowserClient } from "./supabase-browser";

// Server auth utilities
export { getAuthMode, isLocalAuthEnabled } from "./auth-mode";
export {
  LOCAL_AUTH_COOKIE,
  parseLocalAuthPayload,
  createLocalAccount,
  signInLocalAccount,
  changeLocalPassword,
  getLocalAccount,
  updateLocalAvatar,
  revokeLocalSession,
  setLocalSessionCookie,
  clearLocalSessionCookie,
} from "./local-auth";
export { createSupabaseServerClient, getSupabaseUser } from "./supabase-server";
export { getCurrentAccount } from "./current-account";
export { getAuthenticatedLocalAccount, getLocalSessionToken } from "./local-session";
