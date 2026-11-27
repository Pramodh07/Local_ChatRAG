import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalObjectStorage } from "@/modules/rag/local-object-storage";
import { buildDocumentStorageKey, isSafeStorageKey } from "@/modules/rag/object-storage";
import { StorageError } from "@/modules/shared/lib/errors";

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const DOCUMENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VERSION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const KEY = `${OWNER_ID}/${DOCUMENT_ID}/${VERSION_ID}`;

let directory: string | undefined;

afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

describe("local object storage", () => {
  it("round-trips private objects and deletes them", async () => {
    directory = await mkdtemp(path.join(tmpdir(), "atlas-storage-"));
    const storage = createLocalObjectStorage({ rootDirectory: directory });
    const data = new TextEncoder().encode("private document");

    await storage.put(KEY, data, "text/plain");
    await expect(storage.get(KEY)).resolves.toEqual(data);
    await storage.delete(KEY);
    await expect(storage.get(KEY)).rejects.toBeInstanceOf(StorageError);
  });

  it("rejects unsafe keys before touching the filesystem", async () => {
    directory = await mkdtemp(path.join(tmpdir(), "atlas-storage-"));
    const storage = createLocalObjectStorage({ rootDirectory: directory });

    await expect(storage.put("../escape", new Uint8Array([1]), "text/plain")).rejects.toBeInstanceOf(
      StorageError,
    );
  });

  it("builds only UUID-scoped keys", () => {
    expect(buildDocumentStorageKey({ ownerId: OWNER_ID, documentId: DOCUMENT_ID, versionId: VERSION_ID })).toBe(KEY);
    expect(isSafeStorageKey(KEY)).toBe(true);
    expect(isSafeStorageKey(`${OWNER_ID}/../${VERSION_ID}`)).toBe(false);
    expect(isSafeStorageKey("not-a-uuid/doc/version")).toBe(false);
  });
});
