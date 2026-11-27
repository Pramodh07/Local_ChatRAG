import { afterEach, describe, expect, it, vi } from "vitest";
import { logStructured, newRequestId } from "@/modules/shared/lib/logger";

describe("structured logger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits one JSON object with level, event and fields", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    logStructured("info", "health checked", { status: "ok" });

    expect(log).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(String(log.mock.calls[0]?.[0]));
    expect(entry).toMatchObject({ level: "info", event: "health checked", status: "ok" });
    expect(entry.timestamp).toEqual(expect.any(String));
  });

  it("routes errors to console.error with the error field", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    logStructured("error", "request failed", { error: "boom" });

    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).toContain('"error":"boom"');
  });

  it("provides a request id", () => {
    expect(newRequestId()).toEqual(expect.any(String));
  });
});
