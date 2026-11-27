import "server-only";

import { StorageError } from "@/modules/shared/lib/errors";

/**
 * Private object storage for original uploads.
 *
 * Keys are server-generated and always start with the owner id, which lets a
 * bucket policy enforce isolation even if an application check is bypassed.
 */
export type ObjectStorage = {
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type StorageKeyParts = {
  ownerId: string;
  documentId: string;
  versionId: string;
};

export function buildDocumentStorageKey({
  ownerId,
  documentId,
  versionId,
}: StorageKeyParts): string {
  if (
    !UUID_PATTERN.test(ownerId) ||
    !UUID_PATTERN.test(documentId) ||
    !UUID_PATTERN.test(versionId)
  ) {
    throw new Error("Storage keys require server-generated UUID identifiers.");
  }
  return `${ownerId}/${documentId}/${versionId}`;
}

/** Rejects traversal, absolute paths, and keys outside the owner/document layout. */
export function isSafeStorageKey(key: string): boolean {
  const parts = key.split("/");
  return (
    parts.length === 3 &&
    UUID_PATTERN.test(parts[0] ?? "") &&
    UUID_PATTERN.test(parts[1] ?? "") &&
    UUID_PATTERN.test(parts[2] ?? "")
  );
}

export function assertSafeStorageKey(key: string): void {
  if (!isSafeStorageKey(key)) {
    throw new StorageError("The document storage key was invalid.");
  }
}
