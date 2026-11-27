import type { AccountPreferences } from "@/modules/account/types";
import { isModelProvider } from "@/modules/account/types";
import { isRecord } from "@/modules/shared/lib/guards";
import { parseFailed, parseOk, type ParseResult } from "@/modules/shared/lib/parse";
import { isTheme } from "@/modules/shared/lib/theme";

export const EMPTY_PREFERENCE_MESSAGE = "Provide at least one valid preference.";
export const UNSUPPORTED_PREFERENCE_MESSAGE = "The request contains unsupported preferences.";
export const PROVIDER_MODEL_PAIR_MESSAGE = "Choose a provider and model together.";

/**
 * Normalizes a PATCH body into a partial preference update while preserving
 * the per-field messages the account UI already relies on.
 */
export function parsePreferenceUpdate(value: unknown): ParseResult<Partial<AccountPreferences>> {
  if (!isRecord(value) || Object.keys(value).length === 0) {
    return parseFailed(EMPTY_PREFERENCE_MESSAGE, 400);
  }

  const update: Partial<AccountPreferences> = {};
  if ("theme" in value) {
    if (!isTheme(value.theme)) return parseFailed("Theme must be dark or light.", 400);
    update.theme = value.theme;
  }
  if ("provider" in value) {
    if (!isModelProvider(value.provider)) {
      return parseFailed("Select a supported model provider.", 400);
    }
    update.provider = value.provider;
  }
  if ("model" in value) {
    if (typeof value.model !== "string" || !value.model.trim() || value.model.length > 200) {
      return parseFailed("Select a valid model.", 400);
    }
    update.model = value.model.trim();
  }
  if (Object.keys(update).length !== Object.keys(value).length) {
    return parseFailed(UNSUPPORTED_PREFERENCE_MESSAGE, 400);
  }
  if (("provider" in update) !== ("model" in update)) {
    return parseFailed(PROVIDER_MODEL_PAIR_MESSAGE, 400);
  }
  return parseOk(update);
}
