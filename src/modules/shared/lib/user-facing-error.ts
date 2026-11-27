import { errorMessageFromPayload } from "@/modules/shared/lib/http";

const SESSION_EXPIRED = "Your session expired. Sign in again to continue.";
const SERVER_UNREACHABLE = "Atlas couldn't reach the server. Check your connection and try again.";

export function chatErrorMessage(status: number, payload: unknown): string {
  if (status === 400) {
    return errorMessageFromPayload(payload, "The message could not be sent. Check it and try again.");
  }
  if (status === 401) return SESSION_EXPIRED;
  if (status === 409) return "Choose a supported model in Models, then try again.";
  if (status === 429) return "Too many requests. Wait a moment and try again.";
  if (status === 503) {
    return "Atlas couldn't reach the selected model. Check the model configuration in Models and try again.";
  }
  if (status >= 500) return "The model request failed. Try again in a moment.";
  return "The chat request failed. Try again.";
}

export function documentErrorMessage(status: number, payload: unknown): string {
  if (status === 400) {
    return errorMessageFromPayload(payload, "That file could not be indexed. Check the file and try again.");
  }
  if (status === 401) return SESSION_EXPIRED;
  if (status === 413) return "That file is too large to index.";
  if (status === 415) return "Upload a PDF, Markdown, or text file.";
  if (status === 503) return "Document uploads aren't available in this workspace yet.";
  if (status >= 500) return "Document indexing failed. Try again in a moment.";
  return "Document indexing failed. Try again.";
}

export function networkErrorMessage(): string {
  return SERVER_UNREACHABLE;
}
