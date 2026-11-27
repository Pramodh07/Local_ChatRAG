import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/modules/shared/integrations/database.types";
import { consumeApiRateLimit } from "@/modules/shared/integrations/api-rate-limit";
import { RateLimitExceededError } from "@/modules/shared/lib/errors";
import {
  createIngestionService,
  type IngestionService,
  type ProcessJobsInput,
  type UploadDocumentInput,
} from "@/modules/rag/ingestion-service";
import type {
  DocumentRecord,
  JobRecord,
  ProcessResult,
  UploadJobResponse,
} from "@/modules/rag/ingestion-types";

type DocumentServiceDependencies = {
  consumeRateLimit: (
    supabase: SupabaseClient<Database>,
    action: "document_upload",
  ) => Promise<{ allowed: boolean; retryAfterSeconds: number }>;
  ingestion: IngestionService;
};

export type ListDocumentsInput = {
  ownerId: string;
  supabase: SupabaseClient<Database>;
};

export type DeleteDocumentInput = ListDocumentsInput & {
  documentId: string;
};

export type RetryJobInput = ListDocumentsInput & {
  jobId: string;
};

/**
 * Application service for the Knowledge Base API.
 *
 * The upload allowance is checked before the multipart body is parsed so an
 * abusive request is rejected without reading the file into memory (SEC-11).
 */
export function createDocumentService(
  overrides: Partial<DocumentServiceDependencies> = {},
) {
  const dependencies: DocumentServiceDependencies = {
    consumeRateLimit: consumeApiRateLimit,
    ingestion: createIngestionService(),
    ...overrides,
  };

  return {
    async checkUploadRateLimit({ supabase }: { supabase: SupabaseClient<Database> }) {
      const rateLimit = await dependencies.consumeRateLimit(supabase, "document_upload");
      if (!rateLimit.allowed) {
        throw new RateLimitExceededError(
          "Upload limit reached. Please wait before uploading another document.",
          rateLimit.retryAfterSeconds,
        );
      }
    },

    async list({ ownerId, supabase }: ListDocumentsInput): Promise<DocumentRecord[]> {
      return dependencies.ingestion.listDocuments(ownerId, supabase);
    },

    async delete({ documentId, supabase }: DeleteDocumentInput): Promise<void> {
      await dependencies.ingestion.deleteDocument(supabase, documentId);
    },

    async upload(input: UploadDocumentInput): Promise<UploadJobResponse> {
      return dependencies.ingestion.upload(input);
    },

    async processJobs(input: ProcessJobsInput): Promise<ProcessResult> {
      return dependencies.ingestion.processJobs(input);
    },

    async retryJob({ jobId, supabase }: RetryJobInput): Promise<boolean> {
      return dependencies.ingestion.retryJob(supabase, jobId);
    },

    async getJob({ jobId, ownerId, supabase }: RetryJobInput): Promise<JobRecord | null> {
      return dependencies.ingestion.getJob(ownerId, supabase, jobId);
    },
  };
}

export type DocumentService = ReturnType<typeof createDocumentService>;
