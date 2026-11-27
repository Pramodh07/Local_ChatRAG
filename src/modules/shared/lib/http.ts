import { isRecord } from "@/modules/shared/lib/guards";

export const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" } as const;

export function errorMessageFromPayload(value: unknown, fallback: string): string {
  return isRecord(value) && typeof value.error === "string" ? value.error : fallback;
}
