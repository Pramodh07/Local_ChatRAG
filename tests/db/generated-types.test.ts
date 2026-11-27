import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("generated database types", () => {
  it(
    "match the migrated schema",
    () => {
      expect(() =>
        execFileSync(process.execPath, ["scripts/generate-db-types.mjs", "--check"], {
          cwd: process.cwd(),
          stdio: "pipe",
        }),
      ).not.toThrow();
    },
    120_000,
  );
});
