export type AppErrorInit = {
  status: number;
  code: string;
  /**
   * When false, the response mapper replaces the message with the caller's
   * fallback. Use this for internal failures whose message may leak details.
   */
  expose?: boolean;
  headers?: Record<string, string>;
  cause?: unknown;
};

/**
 * Base class for errors that carry an HTTP status and a stable code. Services
 * throw these; route handlers translate them with `errorResponse`.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly expose: boolean;
  readonly headers?: Record<string, string>;

  constructor(message: string, init: AppErrorInit) {
    super(message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = new.target.name;
    this.status = init.status;
    this.code = init.code;
    this.expose = init.expose ?? init.status < 500;
    this.headers = init.headers;
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, { status: 400, code: "validation_failed", expose: true });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized.") {
    super(message, { status: 401, code: "unauthorized", expose: true });
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string) {
    super(message, { status: 403, code: "forbidden", expose: true });
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(message, { status: 404, code: "not_found", expose: true });
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, { status: 409, code: "conflict", expose: true });
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(message: string) {
    super(message, { status: 413, code: "payload_too_large", expose: true });
  }
}

export class RateLimitExceededError extends AppError {
  readonly retryAfterSeconds: number;

  constructor(message: string, retryAfterSeconds: number) {
    super(message, {
      status: 429,
      code: "rate_limit_exceeded",
      expose: true,
      headers: { "Retry-After": String(retryAfterSeconds) },
    });
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class UpstreamError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, { status: 502, code: "upstream_failed", expose: true, cause });
  }
}

export class ServiceConfigurationError extends AppError {
  constructor(message: string) {
    super(message, { status: 503, code: "service_configuration", expose: true });
  }
}

export class DocumentProcessingError extends AppError {
  constructor(message: string) {
    super(message, { status: 400, code: "document_processing_failed", expose: true });
  }
}

export class UnauthenticatedError extends AppError {
  constructor() {
    super("Sign in to use this endpoint.", { status: 401, code: "unauthenticated", expose: true });
  }
}

export class RateLimitCheckError extends AppError {
  constructor(cause?: unknown) {
    super("API rate limits could not be checked.", {
      status: 503,
      code: "rate_limit_check_failed",
      expose: false,
      cause,
    });
  }
}

export class StorageError extends AppError {
  constructor(message = "Document storage is temporarily unavailable.", cause?: unknown) {
    super(message, {
      status: 503,
      code: "storage_unavailable",
      expose: false,
      cause,
    });
  }
}
