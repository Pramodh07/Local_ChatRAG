import { beforeEach, describe, expect, it, vi } from "vitest";
import { RateLimitExceededError } from "@/modules/shared/lib/errors";

const mocks = vi.hoisted(() => ({
  getAuthMode: vi.fn(() => "supabase"),
  getLocalAccount: vi.fn(),
  createSupabaseClient: vi.fn(),
  getSupabaseUser: vi.fn(),
  checkUploadRateLimit: vi.fn(),
  upload: vi.fn(),
  list: vi.fn(),
  deleteDocument: vi.fn(),
  processJobs: vi.fn(),
  retryJob: vi.fn(),
  getJob: vi.fn(),
}));

vi.mock("@/modules/auth/auth-mode", () => ({ getAuthMode: mocks.getAuthMode }));
vi.mock("@/modules/auth/local-session", () => ({
  getAuthenticatedLocalAccount: mocks.getLocalAccount,
}));
vi.mock("@/modules/auth/supabase-server", () => ({
  createSupabaseServerClient: mocks.createSupabaseClient,
  getSupabaseUser: mocks.getSupabaseUser,
}));
vi.mock("@/modules/rag/document-service", () => ({
  createDocumentService: () => ({
    checkUploadRateLimit: mocks.checkUploadRateLimit,
    upload: mocks.upload,
    list: mocks.list,
    delete: mocks.deleteDocument,
    processJobs: mocks.processJobs,
    retryJob: mocks.retryJob,
    getJob: mocks.getJob,
  }),
}));

import { DELETE, GET, POST } from "@/app/api/documents/route";

function uploadRequest(file?: File): Request {
  const formData = new FormData();
  if (file) formData.append("file", file);
  return new Request("http://localhost/api/documents", {
    method: "POST",
    body: formData,
  });
}

beforeEach(() => {
  mocks.getAuthMode.mockReturnValue("supabase");
  mocks.createSupabaseClient.mockResolvedValue({});
  mocks.getSupabaseUser.mockResolvedValue({ id: "user-1" });
  mocks.checkUploadRateLimit.mockReset();
  mocks.checkUploadRateLimit.mockResolvedValue(undefined);
  mocks.upload.mockReset();
  mocks.list.mockReset();
  mocks.deleteDocument.mockReset();
});

describe("documents route contract", () => {
  it("lists the signed-in user's documents", async () => {
    const documents = [{
      id: "35ca4b39-e9a5-43ec-9dd4-2e5b6f122edf",
      name: "notes.txt",
      mime_type: "text/plain",
      chunk_count: 2,
      status: "ready",
      last_error: null,
      created_at: "2025-01-01T00:00:00.000Z",
      updated_at: "2025-01-01T00:00:00.000Z",
      job_id: null,
      job_status: null,
    }];
    mocks.list.mockResolvedValue(documents);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ documents });
    expect(mocks.list).toHaveBeenCalledWith({ ownerId: "user-1", supabase: {} });
  });

  it("requires authentication before listing documents", async () => {
    mocks.getSupabaseUser.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("rejects malformed document ids before deleting", async () => {
    const response = await DELETE(new Request("http://localhost/api/documents?id=not-a-uuid", { method: "DELETE" }));

    expect(response.status).toBe(400);
    expect(mocks.deleteDocument).not.toHaveBeenCalled();
  });

  it("deletes a document for an authenticated owner", async () => {
    const id = "35ca4b39-e9a5-43ec-9dd4-2e5b6f122edf";

    const response = await DELETE(new Request(`http://localhost/api/documents?id=${id}`, { method: "DELETE" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ deleted: true });
    expect(mocks.deleteDocument).toHaveBeenCalledWith({
      documentId: id,
      ownerId: "user-1",
      supabase: {},
    });
  });

  it("returns 401 for an unauthenticated Supabase request before checking limits", async () => {
    mocks.getSupabaseUser.mockResolvedValue(null);

    const response = await POST(uploadRequest(new File(["x"], "notes.txt", { type: "text/plain" })));

    expect(response.status).toBe(401);
    expect(mocks.checkUploadRateLimit).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("checks the upload allowance before parsing the multipart body", async () => {
    mocks.checkUploadRateLimit.mockRejectedValue(
      new RateLimitExceededError("Upload limit reached.", 60),
    );

    const response = await POST(uploadRequest());

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    await expect(response.json()).resolves.toEqual({ error: "Upload limit reached." });
    expect(mocks.checkUploadRateLimit).toHaveBeenCalledWith({ supabase: {} });
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("rejects a request without exactly one file after the allowance check", async () => {
    const response = await POST(uploadRequest());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Choose a PDF, TXT, or Markdown file.",
    });
    expect(mocks.checkUploadRateLimit).toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("queues a valid upload and returns 202", async () => {
    const queued = {
      documentId: "doc-1",
      jobId: "job-1",
      name: "notes.txt",
      status: "queued",
      duplicate: false,
    };
    mocks.upload.mockResolvedValue(queued);
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });

    const response = await POST(uploadRequest(file));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ document: queued });
    expect(mocks.upload).toHaveBeenCalledWith(
      expect.objectContaining({
        file: expect.any(File),
        ownerId: "user-1",
        supabase: {},
      }),
    );
    const uploaded = mocks.upload.mock.calls[0][0].file as File;
    expect(uploaded.name).toBe("notes.txt");
    expect(uploaded.size).toBe(file.size);
  });

  it("maps an ingestion rate-limit rejection to 429 with Retry-After", async () => {
    mocks.upload.mockRejectedValue(
      new RateLimitExceededError("Upload limit reached.", 60),
    );

    const response = await POST(uploadRequest(new File(["x"], "notes.txt", { type: "text/plain" })));

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    await expect(response.json()).resolves.toEqual({ error: "Upload limit reached." });
  });

  it("rejects local mode uploads with the existing 503 message", async () => {
    mocks.getAuthMode.mockReturnValue("local");
    mocks.getLocalAccount.mockResolvedValue({
      id: "account-1",
      email: "alice@example.com",
      displayName: "Alice",
      avatarUrl: null,
    });

    const response = await POST(uploadRequest(new File(["x"], "notes.txt", { type: "text/plain" })));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Local auth tests sign-in only. Configure Supabase and OpenAI to index documents.",
    });
  });

  it("returns 503 when auth is unconfigured", async () => {
    mocks.getAuthMode.mockReturnValue("unconfigured");

    const response = await POST(uploadRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("Set AUTH_MODE=local"),
    });
  });
});
