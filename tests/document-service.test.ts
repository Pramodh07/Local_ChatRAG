import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/modules/shared/integrations/database.types";
import { createDocumentService } from "@/modules/rag/document-service";
import type { IngestionService } from "@/modules/rag/ingestion-service";
import type { ProcessResult, UploadJobResponse } from "@/modules/rag/ingestion-types";
import { RateLimitExceededError } from "@/modules/shared/lib/errors";

const supabase = {} as SupabaseClient<Database>;
const ownerId = "11111111-1111-4111-8111-111111111111";
const file = new File(["hello world"], "notes.txt", { type: "text/plain" });

function createIngestion() {
  return {
    upload: vi.fn(async (): Promise<UploadJobResponse> => ({
      documentId: "doc-1",
      jobId: "job-1",
      name: "notes.txt",
      status: "queued",
      duplicate: false,
    })),
    processJobs: vi.fn(async (): Promise<ProcessResult> => ({
      processed: 1,
      succeeded: 1,
      failed: 0,
      retried: 0,
      cleanupDeleted: 0,
      cleanupFailed: 0,
    })),
    deleteDocument: vi.fn(async () => ({ deleted: 1, failed: 0 })),
    retryJob: vi.fn(async () => true),
    getJob: vi.fn(async () => null),
    listDocuments: vi.fn(async () => []),
  } as unknown as IngestionService;
}

describe("document service", () => {
  it("throws a 429 from the pre-parse upload allowance check", async () => {
    const ingestion = createIngestion();
    const service = createDocumentService({
      consumeRateLimit: vi.fn(async () => ({ allowed: false, retryAfterSeconds: 90 })),
      ingestion,
    });

    await expect(service.checkUploadRateLimit({ supabase })).rejects.toBeInstanceOf(
      RateLimitExceededError,
    );
    expect(ingestion.upload).not.toHaveBeenCalled();
  });

  it("checks the allowance without throwing when the budget is available", async () => {
    const service = createDocumentService({
      consumeRateLimit: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 1 })),
      ingestion: createIngestion(),
    });

    await expect(service.checkUploadRateLimit({ supabase })).resolves.toBeUndefined();
  });

  it("delegates the async upload and preserves the owner and chunk size", async () => {
    const ingestion = createIngestion();
    const service = createDocumentService({
      consumeRateLimit: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 1 })),
      ingestion,
    });

    await expect(
      service.upload({ file, ownerId, supabase, chunkSize: 1800, apiKey: "temporary-key" }),
    ).resolves.toEqual({
      documentId: "doc-1",
      jobId: "job-1",
      name: "notes.txt",
      status: "queued",
      duplicate: false,
    });

    expect(ingestion.upload).toHaveBeenCalledWith({
      file,
      ownerId,
      supabase,
      chunkSize: 1800,
      apiKey: "temporary-key",
    });
  });

  it("delegates list, delete, processing, retry, and status reads", async () => {
    const ingestion = createIngestion();
    const service = createDocumentService({ ingestion });
    const documentId = "22222222-2222-4222-8222-222222222222";
    const jobId = "33333333-3333-4333-8333-333333333333";

    await service.list({ ownerId, supabase });
    await service.delete({ documentId, ownerId, supabase });
    await service.processJobs({ ownerId, supabase, limit: 2 });
    await service.retryJob({ jobId, ownerId, supabase });
    await service.getJob({ jobId, ownerId, supabase });

    expect(ingestion.listDocuments).toHaveBeenCalledWith(ownerId, supabase);
    expect(ingestion.deleteDocument).toHaveBeenCalledWith(supabase, documentId);
    expect(ingestion.processJobs).toHaveBeenCalledWith({ ownerId, supabase, limit: 2 });
    expect(ingestion.retryJob).toHaveBeenCalledWith(supabase, jobId);
    expect(ingestion.getJob).toHaveBeenCalledWith(ownerId, supabase, jobId);
  });
});
