type LogLevel = "info" | "warn" | "error";

/**
 * Minimal structured logger. One JSON object per line so deployment platforms
 * can index fields without parsing free-form console output.
 */
export function logStructured(
  level: LogLevel,
  event: string,
  fields: Record<string, unknown> = {},
): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...fields,
  };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else console.log(line);
}

export function newRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? "unavailable";
}
