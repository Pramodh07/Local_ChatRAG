import { describe, expect, it, vi } from "vitest";
import { createIngestionService } from "@/modules/rag/ingestion-service";
import type { EmbeddingBatchClient } from "@/modules/rag/embedding-batch";
import type { ObjectStorage } from "@/modules/rag/object-storage";
import type { RagRepository } from "@/modules/rag/rag-repository";
import type {
  ClaimedIngestionJob,
  EnqueuedIngestion,
  JobStatus,
  StorageCleanupItem,
} from "@/modules/rag/ingestion-types";
import { DocumentProcessingError } from "@/modules/shared/lib/errors";

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const DOCUMENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VERSION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const JOB_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const STORAGE_KEY = `${OWNER_ID}/${DOCUMENT_ID}/${VERSION_ID}`;
const FILE = new File(["hello world"], "notes.txt", { type: "text/plain" });

function createRepository() {
  return {
    matchDocuments: vi.fn(async () => []),
    findIngestionByChecksum: vi.fn(
      async (): Promise<EnqueuedIngestion | null> => null,
    ),
    enqueueIngestion: vi.fn(
      async (_ownerId: string, input): Promise<EnqueuedIngestion> => ({
        documentId: input.documentId,
        versionId: input.versionId,
        jobId: input.jobId,
        status: "queued",
        duplicate: false,
      }),
    ),
    claimJobs: vi.fn(async (): Promise<ClaimedIngestionJob[]> => []),
    beginAttempt: vi.fn(async () => ({
      documentId: DOCUMENT_ID,
      versionId: VERSION_ID,
      storageKey: STORAGE_KEY,
      originalName: "notes.txt",
      mimeType: "text/plain",
      chunkSize: 1200,
    })),
    insertChunks: vi.fn(async () => {}),
    completeJob: vi.fn(async () => {}),
    failJob: vi.fn(async (): Promise<JobStatus> => "queued"),
    retryJob: vi.fn(async () => true),
    getJob: vi.fn(async () => null),
    listDocuments: vi.fn(async () => []),
    deleteDocument: vi.fn(async () => {}),
    claimStorageCleanup: vi.fn(async (): Promise<StorageCleanupItem[]> => []),
    renewLease: vi.fn(async (): Promise<boolean> => true),
    completeStorageCleanup: vi.fn(async () => {}),
    failStorageCleanup: vi.fn(async () => {}),
  } satisfies RagRepository;
}

function createStorage() {
  const objects = new Map<string, Uint8Array>();
  const storage = {
    objects,
    put: vi.fn(async (key: string, data: Uint8Array) => {
      objects.set(key, data);
    }),
    get: vi.fn(async (key: string) => objects.get(key) ?? new Uint8Array()),
    delete: vi.fn(async (key: string) => {
      objects.delete(key);
    }),
  } satisfies ObjectStorage & { objects: Map<string, Uint8Array> };
  return storage;
}

function createEmbeddings(): EmbeddingBatchClient {
  return {
    create: vi.fn(async (inputs: string[]) => inputs.map(() => [0.1, 0.2, 0.3])),
  };
}

function claimedJob(): ClaimedIngestionJob {
  return {
    jobId: JOB_ID,
    ownerId: OWNER_ID,
    documentId: DOCUMENT_ID,
    versionId: VERSION_ID,
    attempts: 1,
    maxAttempts: 3,
    storageKey: STORAGE_KEY,
    originalName: "notes.txt",
    mimeType: "text/plain",
    chunkSize: 1200,
  };
}

function createService(overrides: {
  repository: ReturnType<typeof createRepository>;
  storage: ReturnType<typeof createStorage>;
  embeddings?: EmbeddingBatchClient;
}) {
  const newId = vi
    .fn()
    .mockReturnValueOnce(DOCUMENT_ID)
    .mockReturnValueOnce(VERSION_ID)
    .mockReturnValueOnce(JOB_ID);

  return createIngestionService({
    createRepository: () => overrides.repository,
    createStorage: () => overrides.storage,
    createEmbeddings: () => overrides.embeddings ?? createEmbeddings(),
    newId,
    workerId: () => "worker-1",
  });
}

describe("ingestion service - enqueue", () => {
  it("stores the original, then enqueues document, version, and job", async () => {
    const repository = createRepository();
    const storage = createStorage();
    const service = createService({ repository, storage });

    const result = await service.upload({
      file: FILE,
      ownerId: OWNER_ID,
      supabase: {} as never,
      chunkSize: 1800,
    });

    expect(result).toEqual({
      documentId: DOCUMENT_ID,
      jobId: JOB_ID,
      name: "notes.txt",
      status: "queued",
      duplicate: false,
    });
    expect(storage.put).toHaveBeenCalledWith(
      STORAGE_KEY,
      expect.any(Uint8Array),
      "text/plain",
    );
    expect(repository.enqueueIngestion).toHaveBeenCalledWith(
      OWNER_ID,
      expect.objectContaining({
        documentId: DOCUMENT_ID,
        versionId: VERSION_ID,
        jobId: JOB_ID,
        name: "notes.txt",
        mimeType: "text/plain",
        storageKey: STORAGE_KEY,
        checksum: expect.stringMatching(/^[0-9a-f]{64}$/),
        chunkSize: 1800,
      }),
    );
  });

  it("returns an existing document without storing or enqueueing duplicate bytes", async () => {
    const repository = createRepository();
    repository.findIngestionByChecksum.mockResolvedValue({
      documentId: DOCUMENT_ID,
      versionId: VERSION_ID,
      jobId: JOB_ID,
      status: "succeeded",
      duplicate: true,
    });
    const storage = createStorage();
    const service = createService({ repository, storage });

    const result = await service.upload({
      file: FILE,
      ownerId: OWNER_ID,
      supabase: {} as never,
    });

    expect(result).toMatchObject({
      documentId: DOCUMENT_ID,
      jobId: JOB_ID,
      status: "ready",
      duplicate: true,
    });
    expect(storage.put).not.toHaveBeenCalled();
    expect(repository.enqueueIngestion).not.toHaveBeenCalled();
  });

  it("retries a previously failed checksum and removes the unreferenced new object", async () => {
    const repository = createRepository();
    repository.findIngestionByChecksum.mockResolvedValue({
      documentId: DOCUMENT_ID,
      versionId: VERSION_ID,
      jobId: JOB_ID,
      status: "failed",
      duplicate: true,
    });
    repository.enqueueIngestion.mockResolvedValue({
      documentId: DOCUMENT_ID,
      versionId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      jobId: JOB_ID,
      status: "queued",
      duplicate: false,
    });
    const storage = createStorage();
    const service = createService({ repository, storage });

    const result = await service.upload({
      file: FILE,
      ownerId: OWNER_ID,
      supabase: {} as never,
    });

    expect(result.status).toBe("queued");
    expect(storage.put).toHaveBeenCalledTimes(1);
    expect(storage.delete).toHaveBeenCalledWith(STORAGE_KEY);
    expect(repository.enqueueIngestion).toHaveBeenCalledTimes(1);
  });

  it("rejects an unsupported file before storing it", async () => {
    const repository = createRepository();
    const storage = createStorage();
    const service = createService({ repository, storage });

    await expect(
      service.upload({
        file: new File(["data"], "image.bin", { type: "application/octet-stream" }),
        ownerId: OWNER_ID,
        supabase: {} as never,
      }),
    ).rejects.toBeInstanceOf(DocumentProcessingError);
    expect(storage.put).not.toHaveBeenCalled();
    expect(repository.enqueueIngestion).not.toHaveBeenCalled();
  });

  it("removes the stored object when the transaction fails", async () => {
    const repository = createRepository();
    repository.enqueueIngestion.mockRejectedValue(new Error("queue failed"));
    const storage = createStorage();
    const service = createService({ repository, storage });

    await expect(
      service.upload({ file: FILE, ownerId: OWNER_ID, supabase: {} as never }),
    ).rejects.toThrow("queue failed");
    expect(storage.delete).toHaveBeenCalledWith(STORAGE_KEY);
  });
});

describe("ingestion service - processing", () => {
  it("extracts, embeds, stores chunks, and completes the job", async () => {
    const repository = createRepository();
    repository.claimJobs.mockResolvedValue([claimedJob()]);
    const storage = createStorage();
    storage.objects.set(STORAGE_KEY, new TextEncoder().encode("hello world"));
    const embeddings = createEmbeddings();
    const service = createService({ repository, storage, embeddings });

    const result = await service.processJobs({
      ownerId: OWNER_ID,
      supabase: {} as never,
    });

    expect(result).toMatchObject({ processed: 1, succeeded: 1, failed: 0, retried: 0 });
    expect(repository.beginAttempt).toHaveBeenCalledWith(OWNER_ID, JOB_ID);
    expect(repository.insertChunks).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          documentId: DOCUMENT_ID,
          versionId: VERSION_ID,
          index: 0,
          page: null,
          content: "hello world",
          contentHash: expect.stringMatching(/^[0-9a-f]{64}$/),
          embedding: [0.1, 0.2, 0.3],
          embeddingModel: "text-embedding-3-small",
        }),
      ],
    );
    expect(repository.completeJob).toHaveBeenCalledWith(JOB_ID, {
      chunkCount: 1,
      pageCount: 1,
      embeddingModel: "text-embedding-3-small",
    });
    expect(repository.failJob).not.toHaveBeenCalled();
  });

  it("returns retryable provider failures to the queue", async () => {
    const repository = createRepository();
    repository.claimJobs.mockResolvedValue([claimedJob()]);
    const storage = createStorage();
    storage.objects.set(STORAGE_KEY, new TextEncoder().encode("hello world"));
    const embeddings = createEmbeddings();
    vi.mocked(embeddings.create).mockRejectedValue(new Error("provider down"));
    const service = createService({ repository, storage, embeddings });

    const result = await service.processJobs({
      ownerId: OWNER_ID,
      supabase: {} as never,
    });

    expect(result).toMatchObject({ processed: 1, succeeded: 0, failed: 0, retried: 1 });
    expect(repository.failJob).toHaveBeenCalledWith(JOB_ID, "provider down", true);
    expect(repository.completeJob).not.toHaveBeenCalled();
  });

  it("marks unreadable or unsupported content as a permanent failure", async () => {
    const repository = createRepository();
    repository.claimJobs.mockResolvedValue([claimedJob()]);
    repository.failJob.mockResolvedValue("failed");
    const storage = createStorage();
    const service = createService({ repository, storage });

    const result = await service.processJobs({
      ownerId: OWNER_ID,
      supabase: {} as never,
    });

    expect(result).toMatchObject({ processed: 1, failed: 1 });
    expect(repository.failJob).toHaveBeenCalledWith(
      JOB_ID,
      expect.stringContaining("empty"),
      false,
    );
  });

  it("drains queued storage deletions after processing", async () => {
    const repository = createRepository();
    repository.claimStorageCleanup
      .mockResolvedValueOnce([{ id: 7, storageKey: STORAGE_KEY }])
      .mockResolvedValue([]);
    const storage = createStorage();
    const service = createService({ repository, storage });

    const result = await service.processJobs({
      ownerId: OWNER_ID,
      supabase: {} as never,
    });

    expect(result).toMatchObject({ cleanupDeleted: 1, cleanupFailed: 0 });
    expect(storage.delete).toHaveBeenCalledWith(STORAGE_KEY);
    expect(repository.completeStorageCleanup).toHaveBeenCalledWith(7);
  });
});

describe("ingestion service - deletion and status", () => {
  it("deletes the database rows and the stored object", async () => {
    const repository = createRepository();
    repository.claimStorageCleanup
      .mockResolvedValueOnce([{ id: 9, storageKey: STORAGE_KEY }])
      .mockResolvedValue([]);
    const storage = createStorage();
    const service = createService({ repository, storage });

    const result = await service.deleteDocument({} as never, DOCUMENT_ID);

    expect(repository.deleteDocument).toHaveBeenCalledWith(DOCUMENT_ID);
    expect(storage.delete).toHaveBeenCalledWith(STORAGE_KEY);
    expect(repository.completeStorageCleanup).toHaveBeenCalledWith(9);
    expect(result).toEqual({ deleted: 1, failed: 0 });
  });

  it("delegates retry, job status, and list reads", async () => {
    const repository = createRepository();
    const service = createService({ repository, storage: createStorage() });

    await service.retryJob({} as never, JOB_ID);
    await service.getJob(OWNER_ID, {} as never, JOB_ID);
    await service.listDocuments(OWNER_ID, {} as never);

    expect(repository.retryJob).toHaveBeenCalledWith(JOB_ID);
    expect(repository.getJob).toHaveBeenCalledWith(OWNER_ID, JOB_ID);
    expect(repository.listDocuments).toHaveBeenCalledWith(OWNER_ID);
  });
});
