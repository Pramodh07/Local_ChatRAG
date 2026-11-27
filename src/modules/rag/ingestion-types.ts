/**
 * Domain types shared by the durable ingestion queue, its repositories, and the
 * worker. Status values must stay in sync with the checks in
 * `0007_durable_ingestion.sql`.
 */

export const DOCUMENT_STATUSES = ["queued", "processing", "ready", "failed"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const JOB_STATUSES = ["queued", "processing", "succeeded", "failed"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_STAGES = [
  "queued",
  "extracting",
  "chunking",
  "embedding",
  "storing",
  "done",
] as const;
export type JobStage = (typeof JOB_STAGES)[number];

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;

export type EnqueueIngestionInput = {
  documentId: string;
  versionId: string;
  jobId: string;
  name: string;
  mimeType: string;
  storageKey: string;
  sizeBytes: number;
  checksum: string;
  chunkSize: number;
};

export type EnqueuedIngestion = {
  documentId: string;
  versionId: string;
  jobId: string;
  status: JobStatus;
  duplicate: boolean;
};

export type ClaimedIngestionJob = {
  jobId: string;
  ownerId: string;
  documentId: string;
  versionId: string;
  attempts: number;
  maxAttempts: number;
  storageKey: string;
  originalName: string;
  mimeType: string;
  chunkSize: number;
};

export type IngestionAttempt = {
  documentId: string;
  versionId: string;
  storageKey: string;
  originalName: string;
  mimeType: string;
  chunkSize: number;
};

export type IngestionChunkInsert = {
  documentId: string;
  versionId: string;
  index: number;
  page: number | null;
  content: string;
  contentHash: string;
  embedding: number[];
  embeddingModel: string;
};

export type IngestionCompletion = {
  chunkCount: number;
  pageCount: number;
  embeddingModel: string;
};

export type DocumentRecord = {
  id: string;
  name: string;
  mime_type: string;
  chunk_count: number;
  status: DocumentStatus;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  job_id: string | null;
  job_status: JobStatus | null;
};

export type JobRecord = {
  id: string;
  documentId: string;
  versionId: string;
  status: JobStatus;
  stage: JobStage;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StorageCleanupItem = {
  id: number;
  storageKey: string;
};

export type ProcessResult = {
  processed: number;
  succeeded: number;
  failed: number;
  retried: number;
  cleanupDeleted: number;
  cleanupFailed: number;
};

export type UploadJobResponse = {
  documentId: string;
  jobId: string;
  name: string;
  status: DocumentStatus;
  duplicate: boolean;
};
