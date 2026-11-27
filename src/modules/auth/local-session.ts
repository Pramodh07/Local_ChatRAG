import "server-only";

import { cookies } from "next/headers";
import { isLocalAuthEnabled } from "@/modules/auth/auth-mode";
import { getLocalAccount, LOCAL_AUTH_COOKIE } from "@/modules/auth/local-auth";
import type { AccountInfo } from "@/modules/auth/types";

export async function getLocalSessionToken(): Promise<string | undefined> {
  const cookieStore = await cookies();
  return cookieStore.get(LOCAL_AUTH_COOKIE)?.value;
}

export async function getAuthenticatedLocalAccount(): Promise<AccountInfo | null> {
  if (!isLocalAuthEnabled()) return null;
  return getLocalAccount(await getLocalSessionToken());
}
