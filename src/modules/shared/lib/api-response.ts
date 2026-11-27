import { NextResponse } from "next/server";
import {
  AppError,
  DocumentProcessingError,
  RateLimitCheckError,
  RateLimitExceededError,
  ServiceConfigurationError,
  UnauthenticatedError,
} from "@/modules/shared/lib/errors";
import { NO_STORE_HEADERS } from "@/modules/shared/lib/http";
import { logStructured } from "@/modules/shared/lib/logger";

type ResponseInit = {
  status?: number;
  headers?: Record<string, string>;
};

function mergeHeaders(headers?: Record<string, string>): Record<string, string> {
  return { ...NO_STORE_HEADERS, ...headers };
}

export function jsonOk<T>(body: T, init: ResponseInit = {}): NextResponse {
  return NextResponse.json(body, {
    status: init.status ?? 200,
    headers: mergeHeaders(init.headers),
  });
}

export function jsonError(
  message: string,
  status: number,
  headers?: Record<string, string>,
): NextResponse {
  return NextResponse.json({ error: message }, { status, headers: mergeHeaders(headers) });
}

export type ErrorResponseOptions = {
  /** Prefix used when logging an unexpected or server-side failure. */
  logLabel: string;
  /** Message returned for unexpected failures and non-exposed 5xx errors. */
  fallbackMessage: string;
  /** Route-specific public message for rate-limit infrastructure failures. */
  rateLimitCheckMessage?: string;
  headers?: Record<string, string>;
};

/**
 * The single place that decides how a thrown error becomes an HTTP response.
 *
 * - Known 4xx errors expose their message.
 * - Known 5xx errors expose only when explicitly marked (`ServiceConfigurationError`).
 * - Rate-limit infrastructure failures use a route-specific message.
 * - Everything else is logged and replaced with the fallback message.
 */
export function errorResponse(error: unknown, options: ErrorResponseOptions): NextResponse {
  const headers = mergeHeaders(options.headers);

  if (error instanceof UnauthenticatedError) {
    return jsonError(error.message, error.status, headers);
  }
  if (error instanceof DocumentProcessingError) {
    return jsonError(error.message, error.status, headers);
  }
  if (error instanceof ServiceConfigurationError) {
    return jsonError(error.message, error.status, headers);
  }
  if (error instanceof RateLimitCheckError) {
    logStructured("error", options.logLabel, { error: error.cause ?? error.message });
    return jsonError(options.rateLimitCheckMessage ?? options.fallbackMessage, error.status, headers);
  }
  if (error instanceof RateLimitExceededError) {
    return jsonError(error.message, error.status, { ...headers, ...error.headers });
  }
  if (error instanceof AppError) {
    if (error.status >= 500) {
      logStructured("error", options.logLabel, { error: error.cause ?? error.message });
    }
    return jsonError(
      error.expose ? error.message : options.fallbackMessage,
      error.status,
      { ...headers, ...error.headers },
    );
  }

  logStructured("error", options.logLabel, { error: error instanceof Error ? error.message : error });
  return jsonError(options.fallbackMessage, 500, headers);
}
