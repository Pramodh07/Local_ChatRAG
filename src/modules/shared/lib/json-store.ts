import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { getDatabaseProvider } from "@/modules/shared/config/providers";

const STORE_DIRECTORY = path.join(process.cwd(), ".local-data");

export type StoreMutation<T> = {
  result: T;
  changed: boolean;
};

type JsonStoreOptions<T> = {
  fileName: string;
  createEmpty: () => T;
  validate: (value: unknown) => value is T;
  invalidJsonMessage: string;
  unsupportedFormatMessage: string;
  /**
   * Overrides provider selection. Tests use this to exercise the embedded
   * PostgreSQL backend with an in-memory database.
   */
  backend?: "auto" | "json" | "postgres";
  database?: () => Promise<PGlite>;
};

export function createJsonStore<T>({
  fileName,
  createEmpty,
  validate,
  invalidJsonMessage,
  unsupportedFormatMessage,
  backend = "auto",
  database,
}: JsonStoreOptions<T>) {
  const storePath = path.join(STORE_DIRECTORY, fileName);
  let queue: Promise<void> = Promise.resolve();
  let cachedJson: T | null = null;

  function usesPostgres(): boolean {
    if (backend === "json") return false;
    if (backend === "postgres") return true;
    return getDatabaseProvider() === "postgres";
  }

  async function postgresDatabase(): Promise<PGlite> {
    if (database) return database();
    const { getLocalDatabase } = await import(
      "@/modules/shared/integrations/pglite-runtime"
    );
    return getLocalDatabase();
  }

  async function readJson(): Promise<T> {
    if (cachedJson !== null) {
      return structuredClone(cachedJson);
    }

    let contents: string;
    try {
      contents = await readFile(storePath, "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        const empty = createEmpty();
        cachedJson = structuredClone(empty);
        return empty;
      }
      throw error;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(contents);
    } catch (error) {
      throw new Error(invalidJsonMessage, { cause: error });
    }
    if (!validate(parsed)) throw new Error(unsupportedFormatMessage);
    cachedJson = structuredClone(parsed);
    return parsed;
  }

  async function writeJson(store: T): Promise<void> {
    await mkdir(STORE_DIRECTORY, { recursive: true, mode: 0o700 });
    const temporaryPath = `${storePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(store, null, 2), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporaryPath, storePath);
    cachedJson = structuredClone(store);
  }

  async function readPostgres(): Promise<T> {
    const db = await postgresDatabase();
    const { rows } = await db.query<{ content: unknown }>(
      "select content from local.json_stores where name = $1",
      [fileName],
    );
    if (rows.length === 0) return createEmpty();
    if (!validate(rows[0].content)) throw new Error(unsupportedFormatMessage);
    return rows[0].content;
  }

  async function mutatePostgres<R>(
    mutation: (store: T) => StoreMutation<R> | Promise<StoreMutation<R>>,
  ): Promise<R> {
    const db = await postgresDatabase();
    return db.transaction(async (tx) => {
      await tx.query(
        `insert into local.json_stores (name, content)
         values ($1, $2::jsonb)
         on conflict (name) do nothing`,
        [fileName, JSON.stringify(createEmpty())],
      );

      const { rows } = await tx.query<{ content: unknown }>(
        "select content from local.json_stores where name = $1 for update",
        [fileName],
      );
      if (rows.length === 0 || !validate(rows[0].content)) {
        throw new Error(unsupportedFormatMessage);
      }

      const store = rows[0].content;
      const { result, changed } = await mutation(store);
      if (changed) {
        await tx.query(
          `update local.json_stores
           set content = $2::jsonb, updated_at = now()
           where name = $1`,
          [fileName, JSON.stringify(store)],
        );
      }
      return result;
    });
  }

  async function read(): Promise<T> {
    return usesPostgres() ? readPostgres() : readJson();
  }

  async function mutate<R>(
    mutation: (store: T) => StoreMutation<R> | Promise<StoreMutation<R>>,
  ): Promise<R> {
    if (usesPostgres()) return mutatePostgres(mutation);

    const operation = queue.then(async () => {
      const store = await readJson();
      const { result, changed } = await mutation(store);
      if (changed) await writeJson(store);
      return result;
    });
    queue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  return { read, mutate };
}
