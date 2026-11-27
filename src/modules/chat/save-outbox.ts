import type { ConversationUpdate } from "@/modules/chat/conversation-diff";

/**
 * Client-side outbox for conversation writes. Writes are idempotent on the
 * server (messages are upserted by id), so replaying an entry is safe.
 */
export type SaveOutboxEntry = {
  key: string;
  ownerId: string;
  update: ConversationUpdate;
};

const STORAGE_KEY = "atlas-save-outbox";
const MAX_ENTRIES = 200;

export function outboxKey(ownerId: string, update: ConversationUpdate): string {
  const ids = update.messages.map(({ message }) => message.id).join(",");
  return `${ownerId}:${update.conversation.id}:${ids || "metadata"}`;
}

export function readOutbox(): SaveOutboxEntry[] {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is SaveOutboxEntry =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as SaveOutboxEntry).key === "string" &&
        typeof (entry as SaveOutboxEntry).ownerId === "string" &&
        typeof (entry as SaveOutboxEntry).update === "object",
    );
  } catch {
    return [];
  }
}

function writeOutbox(entries: SaveOutboxEntry[]): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    // Storage can be unavailable (private mode, quota). In-memory retries still
    // work for the current session.
  }
}

export function addToOutbox(ownerId: string, updates: ConversationUpdate[]): void {
  const existing = readOutbox();
  const byKey = new Map(existing.map((entry) => [entry.key, entry]));
  for (const update of updates) {
    const key = outboxKey(ownerId, update);
    byKey.set(key, { key, ownerId, update });
  }
  writeOutbox([...byKey.values()]);
}

export function removeFromOutbox(keys: string[]): void {
  if (keys.length === 0) return;
  const removed = new Set(keys);
  writeOutbox(readOutbox().filter((entry) => !removed.has(entry.key)));
}
