import type { ChatResponse, Citation } from "@/modules/chat/types";
import type { UploadJobResponse } from "@/modules/rag/ingestion-types";
import { isRecord } from "@/modules/shared/lib/guards";

export function isCitation(value: unknown): value is Citation {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "number" || !Number.isInteger(value.id) || value.id <= 0) return false;
  if (typeof value.doc !== "string" || !value.doc.trim()) return false;
  if (typeof value.excerpt !== "string") return false;
  if (typeof value.score !== "number" || !Number.isFinite(value.score)) return false;
  if (
    value.page !== undefined &&
    (typeof value.page !== "number" || !Number.isInteger(value.page) || value.page <= 0)
  ) {
    return false;
  }
  if (value.section !== undefined && typeof value.section !== "string") {
    return false;
  }
  return true;
}

export function isChatResponse(value: unknown): value is ChatResponse {
  if (!isRecord(value)) return false;
  if (typeof value.answer !== "string") return false;
  if (typeof value.tokens !== "number" || !Number.isFinite(value.tokens) || value.tokens < 0) return false;
  if (!Array.isArray(value.citations) || !value.citations.every(isCitation)) return false;

  if (value.usage !== undefined) {
    if (!isRecord(value.usage)) return false;
    if (typeof value.usage.provider !== "string") return false;
    if (typeof value.usage.model !== "string") return false;
    if (typeof value.usage.inputTokens !== "number" || value.usage.inputTokens < 0) return false;
    if (typeof value.usage.outputTokens !== "number" || value.usage.outputTokens < 0) return false;
    if (
      value.usage.estimatedCostUsd !== null &&
      (typeof value.usage.estimatedCostUsd !== "number" || !Number.isFinite(value.usage.estimatedCostUsd))
    ) {
      return false;
    }
  }

  return true;
}

export function isUploadJobResponse(value: unknown): value is UploadJobResponse {
  return (
    isRecord(value) &&
    typeof value.documentId === "string" &&
    typeof value.jobId === "string" &&
    typeof value.name === "string" &&
    typeof value.duplicate === "boolean" &&
    (value.status === "queued" ||
      value.status === "processing" ||
      value.status === "ready" ||
      value.status === "failed")
  );
}
