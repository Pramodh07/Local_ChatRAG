import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, RetrievedChunk } from "@/modules/shared/integrations/database.types";
import { NotFoundError } from "@/modules/shared/lib/errors";
import {
  DOCUMENT_STATUSES,
  EMBEDDING_MODEL,
  JOB_STATUSES,
  type ClaimedIngestionJob,
  type DocumentRecord,
  type DocumentStatus,
  type EnqueueIngestionInput,
  type EnqueuedIngestion,
  type IngestionAttempt,
  type IngestionChunkInsert,
  type IngestionCompletion,
  type JobRecord,
  type JobStage,
  type JobStatus,
  type StorageCleanupItem,
} from "@/modules/rag/ingestion-types";

export type MatchDocumentsInput = {
  embedding: number[];
  matchCount: number;
  matchThreshold: number;
  signal: AbortSignal;
};

/**
 * The retrieval seam used by answer generation. Keeping it narrow means chat
 * tests do not need the ingestion queue.
 */
export type RetrievalRepository = {
  matchDocuments(input: MatchDocumentsInput): Promise<RetrievedChunk[]>;
};

/**
 * Durable ingestion operations. Every method takes the verified owner and the
 * Supabase adapter also filters by `owner_id`; RLS remains defense in depth.
 */
export type RagRepository = RetrievalRepository & {
  findIngestionByChecksum(
    ownerId: string,
    checksum: string,
  ): Promise<EnqueuedIngestion | null>;
  enqueueIngestion(
    ownerId: string,
    input: EnqueueIngestionInput,
  ): Promise<EnqueuedIngestion>;
  claimJobs(
    workerId: string,
    limit: number,
  ): Promise<ClaimedIngestionJob[]>;
  beginAttempt(ownerId: string, jobId: string): Promise<IngestionAttempt>;
  // Ownership is enforced by RLS and by owner-checked RPCs, so methods that do
  // not actually use an ownerId do not accept one.
  insertChunks(chunks: IngestionChunkInsert[]): Promise<void>;
  completeJob(jobId: string, completion: IngestionCompletion): Promise<void>;
  failJob(jobId: string, message: string, retryable: boolean): Promise<JobStatus>;
  retryJob(jobId: string): Promise<boolean>;
  getJob(ownerId: string, jobId: string): Promise<JobRecord | null>;
  listDocuments(ownerId: string): Promise<DocumentRecord[]>;
  deleteDocument(documentId: string): Promise<void>;
  claimStorageCleanup(limit: number): Promise<StorageCleanupItem[]>;
  /** Extend a claimed job's lock while the worker is still processing it. */
  renewLease(jobId: string): Promise<boolean>;
  completeStorageCleanup(id: number): Promise<void>;
  failStorageCleanup(id: number, message: string): Promise<void>;
};

const JOB_STAGES = new Set<JobStage>([
  "queued",
  "extracting",
  "chunking",
  "embedding",
  "storing",
  "done",
]);

// PostgREST cannot express "latest job per document" (no lateral join or
// DISTINCT ON) and this repository cannot add an RPC. Bound the job read
// instead: fetch only jobs for the documents being displayed, newest first,
// with an explicit cap. If an owner has more retries/versions than the cap,
// older jobs are ignored; each document still resolves to its newest job.
const MAX_JOB_ROWS_PER_DOCUMENT = 8;
const MAX_JOB_ROWS = 1_000;

function documentStatus(value: string): DocumentStatus {
  return (DOCUMENT_STATUSES as readonly string[]).includes(value)
    ? (value as DocumentStatus)
    : "failed";
}

function jobStatus(value: string): JobStatus {
  return (JOB_STATUSES as readonly string[]).includes(value)
    ? (value as JobStatus)
    : "failed";
}

function jobStage(value: string): JobStage {
  return JOB_STAGES.has(value as JobStage) ? (value as JobStage) : "queued";
}

function isMissingJob(error: { code?: string; message?: string } | null): boolean {
  return (
    error?.code === "P0002" ||
    /not found|not available/i.test(error?.message ?? "")
  );
}

export function createSupabaseRagRepository(
  supabase: SupabaseClient<Database>,
): RagRepository {
  return {
    async matchDocuments({ embedding, matchCount, matchThreshold, signal }) {
      const { data, error } = await supabase
        .rpc("match_documents", {
          query_embedding: embedding,
          match_count: matchCount,
          match_threshold: matchThreshold,
        })
        .abortSignal(signal);
      if (error) throw error;
      return data ?? [];
    },

    async findIngestionByChecksum(ownerId, checksum) {
      const { data: version, error } = await supabase
        .from("document_versions")
        .select("id, document_id, status")
        .eq("owner_id", ownerId)
        .eq("checksum_sha256", checksum)
        .maybeSingle();
      if (error) throw error;
      if (!version) return null;

      const { data: job, error: jobError } = await supabase
        .from("ingestion_jobs")
        .select("id, status")
        .eq("owner_id", ownerId)
        .eq("version_id", version.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (jobError) throw jobError;

      return {
        documentId: version.document_id,
        versionId: version.id,
        jobId: job?.id ?? version.id,
        status: jobStatus(job?.status ?? version.status),
        duplicate: true,
      };
    },

    async enqueueIngestion(ownerId, input) {
      const { data, error } = await supabase.rpc("enqueue_document_ingestion", {
        p_document_id: input.documentId,
        p_version_id: input.versionId,
        p_job_id: input.jobId,
        p_name: input.name,
        p_mime_type: input.mimeType,
        p_storage_key: input.storageKey,
        p_size_bytes: input.sizeBytes,
        p_checksum: input.checksum,
        p_chunk_size: input.chunkSize,
      });
      if (error) throw error;
      const row = data?.[0];
      if (!row) throw new Error("The ingestion queue did not return a job.");
      return {
        documentId: row.document_id,
        versionId: row.version_id,
        jobId: row.job_id,
        status: jobStatus(row.status),
        duplicate: row.duplicate,
      };
    },

    async claimJobs(workerId, limit) {
      const { data, error } = await supabase.rpc("claim_ingestion_jobs", {
        p_worker_id: workerId,
        p_limit: limit,
      });
      if (error) throw error;
      return (data ?? []).map((row) => ({
        jobId: row.job_id,
        ownerId: row.owner_id,
        documentId: row.document_id,
        versionId: row.version_id,
        attempts: row.attempts,
        maxAttempts: row.max_attempts,
        storageKey: row.storage_key,
        originalName: row.original_name,
        mimeType: row.mime_type,
        chunkSize: row.chunk_size,
      }));
    },

    async beginAttempt(ownerId, jobId) {
      const { data, error } = await supabase.rpc("begin_ingestion_attempt", {
        p_job_id: jobId,
      });
      if (error) throw error;
      const row = data?.[0];
      if (!row) throw new Error("The ingestion job could not be started.");
      return {
        documentId: row.document_id,
        versionId: row.version_id,
        storageKey: row.storage_key,
        originalName: row.original_name,
        mimeType: row.mime_type,
        chunkSize: row.chunk_size,
      };
    },

    async insertChunks(chunks) {
      if (chunks.length === 0) return;
      const { error } = await supabase.from("document_chunks").insert(
        chunks.map((chunk) => ({
          document_id: chunk.documentId,
          version_id: chunk.versionId,
          chunk_index: chunk.index,
          page: chunk.page,
          content: chunk.content,
          content_hash: chunk.contentHash,
          embedding: chunk.embedding,
          embedding_model: chunk.embeddingModel,
        })),
      );
      if (error) throw error;
    },

    async completeJob(jobId, completion) {
      const { error } = await supabase.rpc("complete_ingestion_job", {
        p_job_id: jobId,
        p_chunk_count: completion.chunkCount,
        p_page_count: completion.pageCount,
        p_embedding_model: completion.embeddingModel,
      });
      if (error) throw error;
    },

    async failJob(jobId, message, retryable) {
      const { data, error } = await supabase.rpc("fail_ingestion_job", {
        p_job_id: jobId,
        p_error: message.slice(0, 1000),
        p_retryable: retryable,
      });
      if (error) throw error;
      return jobStatus(typeof data === "string" ? data : "failed");
    },

    async retryJob(jobId) {
      const { data, error } = await supabase.rpc("retry_ingestion_job", {
        p_job_id: jobId,
      });
      if (error) throw error;
      return data === true;
    },

    async getJob(ownerId, jobId) {
      const { data, error } = await supabase
        .from("ingestion_jobs")
        .select(
          "id, document_id, version_id, status, stage, attempts, max_attempts, last_error, created_at, updated_at",
        )
        .eq("owner_id", ownerId)
        .eq("id", jobId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        id: data.id,
        documentId: data.document_id,
        versionId: data.version_id,
        status: jobStatus(data.status),
        stage: jobStage(data.stage),
        attempts: data.attempts,
        maxAttempts: data.max_attempts,
        lastError: data.last_error,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      };
    },

    async listDocuments(ownerId) {
      const { data: documents, error } = await supabase
        .from("documents")
        .select(
          "id, name, mime_type, chunk_count, status, last_error, created_at, updated_at",
        )
        .eq("owner_id", ownerId)
        .order("created_at", { ascending: false });
      if (error) throw error;

      const documentIds = (documents ?? []).map((document) => document.id);
      let jobs: { id: string; document_id: string; status: string }[] = [];
      if (documentIds.length > 0) {
        const limit = Math.min(documentIds.length * MAX_JOB_ROWS_PER_DOCUMENT, MAX_JOB_ROWS);
        const { data, error: jobsError } = await supabase
          .from("ingestion_jobs")
          .select("id, document_id, status")
          .eq("owner_id", ownerId)
          .in("document_id", documentIds)
          .order("created_at", { ascending: false })
          .limit(limit);
        if (jobsError) throw jobsError;
        jobs = data ?? [];
      }

      const latestJob = new Map<string, { id: string; status: JobStatus }>();
      for (const job of jobs) {
        if (!latestJob.has(job.document_id)) {
          latestJob.set(job.document_id, { id: job.id, status: jobStatus(job.status) });
        }
      }

      return (documents ?? []).map((document) => {
        const job = latestJob.get(document.id);
        return {
          id: document.id,
          name: document.name,
          mime_type: document.mime_type,
          chunk_count: document.chunk_count,
          status: documentStatus(document.status),
          last_error: document.last_error,
          created_at: document.created_at,
          updated_at: document.updated_at,
          job_id: job?.id ?? null,
          job_status: job?.status ?? null,
        };
      });
    },

    async deleteDocument(documentId) {
      const { error } = await supabase.rpc("delete_document_for_owner", {
        p_document_id: documentId,
      });
      if (error) {
        if (isMissingJob(error)) throw new NotFoundError("Document not found.");
        throw error;
      }
    },

    async claimStorageCleanup(limit) {
      const { data, error } = await supabase.rpc("claim_storage_cleanup", {
        p_limit: limit,
      });
      if (error) throw error;
      return (data ?? []).map((row) => ({
        id: row.id,
        storageKey: row.storage_key,
      }));
    },

    async renewLease(jobId) {
      const { data, error } = await supabase.rpc("renew_ingestion_lease", {
        p_job_id: jobId,
      });
      if (error) throw error;
      return data === true;
    },

    async completeStorageCleanup(id) {
      const { error } = await supabase.rpc("complete_storage_cleanup", { p_id: id });
      if (error) throw error;
    },

    async failStorageCleanup(id, message) {
      const { error } = await supabase.rpc("fail_storage_cleanup", {
        p_id: id,
        p_error: message.slice(0, 1000),
      });
      if (error) throw error;
    },
  };
}

export const DEFAULT_EMBEDDING_MODEL = EMBEDDING_MODEL;
