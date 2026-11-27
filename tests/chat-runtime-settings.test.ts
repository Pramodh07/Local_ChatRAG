import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHAT_RUNTIME_SETTINGS,
  isChatRuntimeSettings,
  readDocumentChunkSize,
} from "@/modules/chat/runtime-settings";
import { ValidationError } from "@/modules/shared/lib/errors";

describe("chat runtime settings", () => {
  it("uses safe defaults for missing settings", () => {
    expect(isChatRuntimeSettings(DEFAULT_CHAT_RUNTIME_SETTINGS)).toBe(true);
    expect(readDocumentChunkSize(new Request("http://localhost/api/documents"))).toBe(1200);
  });

  it("validates the requested chunk size", () => {
    const request = new Request("http://localhost/api/documents", {
      headers: { "x-atlas-chunk-size": "1800" },
    });
    expect(readDocumentChunkSize(request)).toBe(1800);
    expect(() =>
      readDocumentChunkSize(new Request("http://localhost/api/documents", {
        headers: { "x-atlas-chunk-size": "399" },
      })),
    ).toThrow(ValidationError);
  });
});
