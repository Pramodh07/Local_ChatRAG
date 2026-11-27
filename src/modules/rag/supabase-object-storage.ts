import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/modules/shared/integrations/database.types";
import {
  assertSafeStorageKey,
  type ObjectStorage,
} from "@/modules/rag/object-storage";
import { StorageError } from "@/modules/shared/lib/errors";

export const DEFAULT_DOCUMENT_BUCKET = "document-uploads";

export function documentBucketName(): string {
  // Storage policies in migration 0007 hardcode this bucket id, so a custom
  // name can never be scoped correctly. Keep one canonical private bucket.
  return DEFAULT_DOCUMENT_BUCKET;
}

function isAlreadyExists(error: { message?: string; statusCode?: string }): boolean {
  return (
    error.statusCode === "409" ||
    /already exists/i.test(error.message ?? "") ||
    /duplicate/i.test(error.message ?? "")
  );
}

/**
 * Supabase Storage adapter.
 *
 * The bucket is private. Objects are addressed as
 * `{ownerId}/{documentId}/{versionId}`, and the migration installs policies
 * that compare the first path segment with `auth.uid()`, so the user-scoped
 * client can read and write only its own uploads.
 */
export function createSupabaseObjectStorage(
  supabase: SupabaseClient<Database>,
  bucket = documentBucketName(),
): ObjectStorage {
  return {
    async put(key, data, contentType) {
      assertSafeStorageKey(key);
      const { error } = await supabase.storage.from(bucket).upload(key, data, {
        contentType,
        upsert: false,
        cacheControl: "private, max-age=0",
      });
      if (error && !isAlreadyExists(error)) {
        throw new StorageError("The uploaded document could not be stored.", error);
      }
    },

    async get(key) {
      assertSafeStorageKey(key);
      const { data, error } = await supabase.storage.from(bucket).download(key);
      if (error || !data) {
        throw new StorageError("The stored document could not be read.", error);
      }
      return new Uint8Array(await data.arrayBuffer());
    },

    async delete(key) {
      assertSafeStorageKey(key);
      const { error } = await supabase.storage.from(bucket).remove([key]);
      if (error) {
        throw new StorageError("The stored document could not be deleted.", error);
      }
    },
  };
}
