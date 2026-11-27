import "server-only";

import { DEFAULT_PREFERENCES } from "@/modules/account/defaults";
import type { AccountPreferences, UsageBucket } from "@/modules/account/types";
import { isModelProvider } from "@/modules/account/types";
import { isRecord } from "@/modules/shared/lib/guards";
import { createJsonStore } from "@/modules/shared/lib/json-store";
import { isTheme } from "@/modules/shared/lib/theme";

type AccountData = {
  preferences: AccountPreferences;
  usage: UsageBucket[];
};

type LocalAccountStore = {
  version: 1;
  accounts: Record<string, AccountData>;
};

function isUsageBucket(value: unknown): value is UsageBucket {
  return (
    isRecord(value) &&
    typeof value.date === "string" &&
    isModelProvider(value.provider) &&
    typeof value.model === "string" &&
    Number.isSafeInteger(value.requests) &&
    Number.isSafeInteger(value.inputTokens) &&
    Number.isSafeInteger(value.outputTokens) &&
    typeof value.estimatedCostUsd === "number" &&
    Number.isFinite(value.estimatedCostUsd) &&
    typeof value.costEstimateComplete === "boolean"
  );
}

function isAccountData(value: unknown): value is AccountData {
  return (
    isRecord(value) &&
    isRecord(value.preferences) &&
    isModelProvider(value.preferences.provider) &&
    typeof value.preferences.model === "string" &&
    isTheme(value.preferences.theme) &&
    Array.isArray(value.usage) &&
    value.usage.every(isUsageBucket)
  );
}

function isLocalAccountStore(value: unknown): value is LocalAccountStore {
  return (
    isRecord(value) &&
    value.version === 1 &&
    isRecord(value.accounts) &&
    Object.values(value.accounts).every(isAccountData)
  );
}

const accountStore = createJsonStore<LocalAccountStore>({
  fileName: "account-store.json",
  createEmpty: () => ({ version: 1, accounts: {} }),
  validate: isLocalAccountStore,
  invalidJsonMessage: "The local account store is not valid JSON.",
  unsupportedFormatMessage: "The local account store has an unsupported format.",
});

function getAccountData(store: LocalAccountStore, accountId: string): AccountData {
  return (
    store.accounts[accountId] ?? {
      preferences: { ...DEFAULT_PREFERENCES },
      usage: [],
    }
  );
}

export async function getLocalAccountPreferences(accountId: string): Promise<AccountPreferences> {
  return (await getLocalAccountPreferenceState(accountId)).preferences;
}

export async function getLocalAccountPreferenceState(accountId: string): Promise<{
  preferences: AccountPreferences;
  initialized: boolean;
}> {
  const store = await accountStore.read();
  return {
    preferences: { ...getAccountData(store, accountId).preferences },
    initialized: Boolean(store.accounts[accountId]),
  };
}

export async function updateLocalAccountPreferences(
  accountId: string,
  update: Partial<AccountPreferences>,
): Promise<AccountPreferences> {
  return accountStore.mutate((store) => {
    const data = getAccountData(store, accountId);
    const preferences = { ...data.preferences, ...update };
    store.accounts[accountId] = { ...data, preferences };
    return { result: { ...preferences }, changed: true };
  });
}

export async function recordLocalModelUsage(
  accountId: string,
  usage: Omit<UsageBucket, "date" | "requests">,
  now = new Date(),
): Promise<void> {
  const date = now.toISOString().slice(0, 10);
  await accountStore.mutate((store) => {
    const data = getAccountData(store, accountId);
    const existing = data.usage.find(
      (item) => item.date === date && item.provider === usage.provider && item.model === usage.model,
    );
    if (existing) {
      existing.requests += 1;
      existing.inputTokens += usage.inputTokens;
      existing.outputTokens += usage.outputTokens;
      existing.estimatedCostUsd += usage.estimatedCostUsd;
      existing.costEstimateComplete &&= usage.costEstimateComplete;
    } else {
      data.usage.push({ ...usage, date, requests: 1 });
    }
    store.accounts[accountId] = data;
    return { result: undefined, changed: true };
  });
}

export async function getLocalModelUsage(accountId: string): Promise<UsageBucket[]> {
  const store = await accountStore.read();
  return getAccountData(store, accountId).usage
    .map((item) => ({ ...item }))
    .sort((left, right) => right.date.localeCompare(left.date));
}
