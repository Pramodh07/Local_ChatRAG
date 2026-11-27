import { afterEach, describe, expect, it, vi } from "vitest";
import { errorResponse, jsonError, jsonOk } from "@/modules/shared/lib/api-response";
import {
  AppError,
  RateLimitCheckError,
  RateLimitExceededError,
  ServiceConfigurationError,
  UnauthenticatedError,
  ValidationError,
} from "@/modules/shared/lib/errors";

afterEach(() => {
  vi.restoreAllMocks();
});

const options = {
  logLabel: "test operation failed",
  fallbackMessage: "Something went wrong.",
  rateLimitCheckMessage: "Temporarily unavailable.",
};

describe("API response helpers", () => {
  it("marks JSON responses as private and uncached", async () => {
    const ok = jsonOk({ value: 1 });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("private, no-store");
    await expect(ok.json()).resolves.toEqual({ value: 1 });

    const error = jsonError("Nope.", 400);
    expect(error.status).toBe(400);
    expect(error.headers.get("cache-control")).toBe("private, no-store");
    await expect(error.json()).resolves.toEqual({ error: "Nope." });
  });
});

describe("errorResponse", () => {
  it("maps known 4xx errors to their message and status", async () => {
    const response = errorResponse(new ValidationError("Invalid input."), options);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid input." });
  });

  it("maps unauthenticated errors to 401", async () => {
    const response = errorResponse(new UnauthenticatedError(), options);
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("maps rate-limit exhaustion to 429 with Retry-After", async () => {
    const response = errorResponse(
      new RateLimitExceededError("Too many requests.", 30),
      options,
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("30");
    await expect(response.json()).resolves.toEqual({ error: "Too many requests." });
  });

  it("maps rate-limit infrastructure failures to the route-specific message", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = errorResponse(new RateLimitCheckError(new Error("db down")), options);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "Temporarily unavailable." });
    expect(error).toHaveBeenCalled();
  });

  it("exposes service configuration messages", async () => {
    const response = errorResponse(
      new ServiceConfigurationError("Set OPENAI_API_KEY."),
      options,
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "Set OPENAI_API_KEY." });
  });

  it("hides non-exposed 5xx messages behind the fallback", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = errorResponse(
      new AppError("internal detail", {
        status: 500,
        code: "internal",
        expose: false,
      }),
      options,
    );
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Something went wrong." });
    expect(error).toHaveBeenCalled();
  });

  it("logs and hides unexpected errors", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = errorResponse(new Error("boom"), options);
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Something went wrong." });
    const logged = String(error.mock.calls[0]?.[0]);
    expect(logged).toContain('"event":"test operation failed"');
    expect(logged).toContain('"error":"boom"');
  });
});
