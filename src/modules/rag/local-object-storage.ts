import "server-only";

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  assertSafeStorageKey,
  type ObjectStorage,
} from "@/modules/rag/object-storage";
import { StorageError } from "@/modules/shared/lib/errors";

type LocalObjectStorageOptions = {
  rootDirectory: string;
};

function resolveKeyPath(root: string, key: string): string {
  assertSafeStorageKey(key);
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, ...key.split("/"));
  if (!target.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new StorageError("The document storage path was invalid.");
  }
  return target;
}

/**
 * Filesystem storage for tests and single-process development.
 *
 * Production deployments should use a private object store; this adapter is
 * intentionally not selected by the Supabase document path.
 */
export function createLocalObjectStorage({
  rootDirectory,
}: LocalObjectStorageOptions): ObjectStorage {
  return {
    async put(key, data, _contentType) {
      const target = resolveKeyPath(rootDirectory, key);
      try {
        await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
        const temporary = `${target}.${randomUUID()}.tmp`;
        await writeFile(temporary, data, { mode: 0o600 });
        await rename(temporary, target);
      } catch (error) {
        if (error instanceof StorageError) throw error;
        throw new StorageError("The uploaded document could not be stored.", error);
      }
    },

    async get(key) {
      const target = resolveKeyPath(rootDirectory, key);
      try {
        return new Uint8Array(await readFile(target));
      } catch (error) {
        throw new StorageError("The stored document could not be read.", error);
      }
    },

    async delete(key) {
      const target = resolveKeyPath(rootDirectory, key);
      try {
        await rm(target, { force: true });
      } catch (error) {
        throw new StorageError("The stored document could not be deleted.", error);
      }
    },
  };
}
