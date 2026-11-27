import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/modules/shared/integrations/database.types";
import { DEFAULT_DOCUMENT_CHUNK_SIZE } from "@/modules/chat/runtime-settings";
import {
  createOpenAIEmbeddingBatchClient,
  embedTexts,
  type EmbeddingBatchClient,
} from "@/modules/rag/embedding-batch";
import {
  chunkPages,
  extractDocumentPagesFromBytes,
  normalizeUploadMimeType,
  validateUpload,
} from "@/modules/rag/document-processing";
import {
  buildDocumentStorageKey,
  type ObjectStorage,
} from "@/modules/rag/object-storage";
import {
  createSupabaseRagRepository,
  type RagRepository,
} from "@/modules/rag/rag-repository";
import {
  EMBEDDING_MODEL,
  type ClaimedIngestionJob,
  type DocumentRecord,
  type DocumentStatus,
  type EnqueuedIngestion,
  type IngestionAttempt,
  type IngestionChunkInsert,
  type JobRecord,
  type JobStatus,
  type ProcessResult,
  type UploadJobResponse,
} from "@/modules/rag/ingestion-types";
import { createSupabaseObjectStorage } from "@/modules/rag/supabase-object-storage";
import {
  DocumentProcessingError,
  ServiceConfigurationError,
} from "@/modules/shared/lib/errors";
import { logStructured } from "@/modules/shared/lib/logger";

const INSERT_BATCH_SIZE = 50;
const CLEANUP_BATCH_SIZE = 20;
const LEASE_HEARTBEAT_MS = 15_000;

type IngestDependencies = {
  createRepository: (supabase: SupabaseClient<Database>) => RagRepository;
  createStorage: (supabase: SupabaseClient<Database>) => ObjectStorage;
  createEmbeddings: (apiKey?: string) => EmbeddingBatchClient;
  newId: () => string;
  workerId: () => string;
};

export type UploadDocumentInput = {
  file: File;
  ownerId: string;
  supabase: SupabaseClient<Database>;
  apiKey?: string;
  chunkSize?: number;
};

export type ProcessJobsInput = {
  ownerId?: string;
  supabase: SupabaseClient<Database>;
  apiKey?: string;
  limit?: number;
};

function sha256(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function cleanFileName(name: string): string {
  return name.replace(/[\r\n\0]/g, " ").trim().slice(0, 200) || "Untitled document";
}

function documentStatusFromJob(status: JobStatus): DocumentStatus {
  return status === "succeeded" ? "ready" : status;
}

function messageFor(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "The document could not be indexed.";
}

function isRetryableFailure(error: unknown): boolean {
  if (error instanceof DocumentProcessingError) return false;
  if (error instanceof ServiceConfigurationError) return false;
  return true;
}

function asDocumentProcessingError(error: unknown): DocumentProcessingError {
  if (error instanceof DocumentProcessingError) return error;
  return new DocumentProcessingError(messageFor(error));
}

/**
 * Durable ingestion service.
 *
 * Enqueue stores the original bytes first, then creates the document, version,
 * and job in one database transaction. Processing is resumable: a retried
 * attempt deletes prior chunks for the version before writing new ones, and the
 * document only becomes retrievable when the job completes.
 */
export function createIngestionService(
  overrides: Partial<IngestDependencies> = {},
) {
  const dependencies: IngestDependencies = {
    createRepository: createSupabaseRagRepository,
    createStorage: (supabase) => createSupabaseObjectStorage(supabase),
    createEmbeddings: createOpenAIEmbeddingBatchClient,
    newId: () => randomUUID(),
    workerId: () => `web-${randomUUID()}`,
    ...overrides,
  };

  async function upload({
    file,
    ownerId,
    supabase,
    apiKey: _apiKey,
    chunkSize = DEFAULT_DOCUMENT_CHUNK_SIZE,
  }: UploadDocumentInput): Promise<UploadJobResponse> {
    const name = cleanFileName(file.name);
    const mimeType = normalizeUploadMimeType(name, file.type);
    try {
      validateUpload(name, file.type, file.size);
    } catch (error) {
      throw asDocumentProcessingError(error);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const checksum = sha256(bytes);
    const repository = dependencies.createRepository(supabase);

    const existing = await repository.findIngestionByChecksum(ownerId, checksum);
    if (existing && existing.status !== "failed") {
      return {
        documentId: existing.documentId,
        jobId: existing.jobId,
        name,
        status: documentStatusFromJob(existing.status),
        duplicate: true,
      };
    }

    const documentId = dependencies.newId();
    const versionId = dependencies.newId();
    const jobId = dependencies.newId();
    const storageKey = buildDocumentStorageKey({ ownerId, documentId, versionId });
    const storage = dependencies.createStorage(supabase);

    await storage.put(storageKey, bytes, mimeType);

    try {
      const enqueued: EnqueuedIngestion = await repository.enqueueIngestion(ownerId, {
        documentId,
        versionId,
        jobId,
        name,
        mimeType,
        storageKey,
        sizeBytes: bytes.byteLength,
        checksum,
        chunkSize,
      });

      // A concurrent upload with the same checksum may have won the unique
      // constraint. The object written for this request is then unreferenced.
      if (enqueued.versionId !== versionId) {
        await storage.delete(storageKey).catch((error: unknown) => {
          console.error("Failed to remove an unreferenced duplicate upload:", error);
        });
      }

      return {
        documentId: enqueued.documentId,
        jobId: enqueued.jobId,
        name,
        status: enqueued.duplicate
          ? documentStatusFromJob(enqueued.status)
          : "queued",
        duplicate: enqueued.duplicate,
      };
    } catch (error) {
      await storage.delete(storageKey).catch((cleanupError: unknown) => {
        console.error("Failed to remove an unenqueued upload:", cleanupError);
      });
      throw error;
    }
  }

  async function processOne(
    ownerId: string,
    repository: RagRepository,
    storage: ObjectStorage,
    embeddings: EmbeddingBatchClient,
    job: ClaimedIngestionJob,
  ): Promise<"succeeded" | "failed" | "retried"> {
    let attempt: IngestionAttempt;
    try {
      attempt = await repository.beginAttempt(ownerId, job.jobId);
    } catch (error) {
      console.error(`Ingestion job ${job.jobId} could not be started:`, error);
      return "failed";
    }

    // Keep the lease alive while extraction/embedding may exceed the 10-minute
    // stale-lock window. Renewal is best-effort: a transient failure still lets
    // the normal stale-lock recovery take over.
    const heartbeat = setInterval(() => {
      void repository.renewLease(job.jobId).catch((error: unknown) => {
        logStructured("warn", "ingestion.lease_renewal_failed", {
          jobId: job.jobId,
          error: error instanceof Error ? error.message : error,
        });
      });
    }, LEASE_HEARTBEAT_MS);

    try {
      const bytes = await storage.get(attempt.storageKey);

      let extracted;
      try {
        extracted = await extractDocumentPagesFromBytes({
          bytes,
          name: attempt.originalName,
          mimeType: attempt.mimeType,
        });
      } catch (error) {
        throw asDocumentProcessingError(error);
      }

      let chunks;
      try {
        const isPdf =
          extracted.mimeType === "application/pdf" ||
          attempt.originalName.toLowerCase().endsWith(".pdf");
        chunks = chunkPages(extracted.pages, isPdf, attempt.chunkSize);
      } catch (error) {
        throw asDocumentProcessingError(error);
      }

      const vectors = await embedTexts(
        embeddings,
        chunks.map((chunk) => chunk.content),
      );

      const rows: IngestionChunkInsert[] = chunks.map((chunk, index) => ({
        documentId: attempt.documentId,
        versionId: attempt.versionId,
        index,
        page: chunk.page,
        content: chunk.content,
        contentHash: sha256(chunk.content),
        embedding: vectors[index] ?? [],
        embeddingModel: EMBEDDING_MODEL,
      }));

      for (let start = 0; start < rows.length; start += INSERT_BATCH_SIZE) {
        await repository.insertChunks(rows.slice(start, start + INSERT_BATCH_SIZE));
      }

      await repository.completeJob(job.jobId, {
        chunkCount: rows.length,
        pageCount: extracted.pages.length,
        embeddingModel: EMBEDDING_MODEL,
      });
      clearInterval(heartbeat);
      return "succeeded";
    } catch (error) {
      clearInterval(heartbeat);
      const message = messageFor(error);
      const retryable = isRetryableFailure(error);
      try {
        const status = await repository.failJob(job.jobId, message, retryable);
        return status === "failed" ? "failed" : "retried";
      } catch (failureError) {
        console.error(`Ingestion job ${job.jobId} failed to record its error:`, failureError);
        return "failed";
      }
    }
  }

  async function drainStorageCleanup(
    repository: RagRepository,
    storage: ObjectStorage,
  ): Promise<{ deleted: number; failed: number }> {
    let deleted = 0;
    let failed = 0;

    for (;;) {
      const items = await repository.claimStorageCleanup(CLEANUP_BATCH_SIZE);
      if (items.length === 0) break;

      for (const item of items) {
        try {
          await storage.delete(item.storageKey);
          await repository.completeStorageCleanup(item.id);
          deleted += 1;
        } catch (error) {
          failed += 1;
          await repository
            .failStorageCleanup(item.id, messageFor(error))
            .catch((recordError: unknown) => {
              console.error("Failed to record storage cleanup failure:", recordError);
            });
        }
      }

      if (items.length < CLEANUP_BATCH_SIZE) break;
    }

    return { deleted, failed };
  }

  return {
    upload,

    async processJobs({
      supabase,
      apiKey,
      limit = 3,
    }: ProcessJobsInput): Promise<ProcessResult> {
      const repository = dependencies.createRepository(supabase);
      const storage = dependencies.createStorage(supabase);
      const embeddings = dependencies.createEmbeddings(apiKey);
      const jobs = await repository.claimJobs(
        dependencies.workerId(),
        Math.min(Math.max(limit, 1), 5),
      );

      let succeeded = 0;
      let failed = 0;
      let retried = 0;

      for (const job of jobs) {
        const outcome = await processOne(job.ownerId, repository, storage, embeddings, job);
        if (outcome === "succeeded") succeeded += 1;
        else if (outcome === "failed") failed += 1;
        else retried += 1;
      }

      const cleanup = await drainStorageCleanup(repository, storage);

      return {
        processed: jobs.length,
        succeeded,
        failed,
        retried,
        cleanupDeleted: cleanup.deleted,
        cleanupFailed: cleanup.failed,
      };
    },

    async deleteDocument(supabase: SupabaseClient<Database>, documentId: string) {
      const repository = dependencies.createRepository(supabase);
      const storage = dependencies.createStorage(supabase);
      await repository.deleteDocument(documentId);
      return drainStorageCleanup(repository, storage);
    },

    async retryJob(supabase: SupabaseClient<Database>, jobId: string) {
      return dependencies.createRepository(supabase).retryJob(jobId);
    },

    async getJob(
      ownerId: string,
      supabase: SupabaseClient<Database>,
      jobId: string,
    ): Promise<JobRecord | null> {
      return dependencies.createRepository(supabase).getJob(ownerId, jobId);
    },

    async listDocuments(
      ownerId: string,
      supabase: SupabaseClient<Database>,
    ): Promise<DocumentRecord[]> {
      return dependencies.createRepository(supabase).listDocuments(ownerId);
    },
  };
}

export type IngestionService = ReturnType<typeof createIngestionService>;
