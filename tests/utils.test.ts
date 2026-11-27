import { afterEach, describe, expect, it, vi } from "vitest";
import { createId } from "@/modules/shared/lib/utils";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createId", () => {
  it("uses crypto.randomUUID when available", () => {
    vi.stubGlobal("crypto", {
      randomUUID: () => "native-uuid",
      getRandomValues: vi.fn(),
    });

    expect(createId()).toBe("native-uuid");
  });

  it("builds a version 4 UUID with getRandomValues when randomUUID is unavailable", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => bytes.fill(1),
    });

    expect(createId()).toBe("01010101-0101-4101-8101-010101010101");
  });

  it("fails explicitly when secure randomness is unavailable", () => {
    vi.stubGlobal("crypto", undefined);

    expect(() => createId()).toThrow("Secure random number generation is not available.");
  });
});
