import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthMode: vi.fn(() => "supabase"),
  createSupabaseClient: vi.fn(),
  getSupabaseUser: vi.fn(),
  processJobs: vi.fn(),
  retryJob: vi.fn(),
  getJob: vi.fn(),
}));

vi.mock("@/modules/auth/auth-mode", () => ({ getAuthMode: mocks.getAuthMode }));
vi.mock("@/modules/auth/supabase-server", () => ({
  createSupabaseServerClient: mocks.createSupabaseClient,
  getSupabaseUser: mocks.getSupabaseUser,
}));
vi.mock("@/modules/rag/document-service", () => ({
  createDocumentService: () => ({
    processJobs: mocks.processJobs,
    retryJob: mocks.retryJob,
    getJob: mocks.getJob,
  }),
}));

import { GET, POST } from "@/app/api/documents/jobs/route";

const JOB_ID = "33333333-3333-4333-8333-333333333333";

function jobRequest(body: unknown): Request {
  return new Request("http://localhost/api/documents/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.getAuthMode.mockReturnValue("supabase");
  mocks.createSupabaseClient.mockResolvedValue({});
  mocks.getSupabaseUser.mockResolvedValue({ id: "user-1" });
  mocks.processJobs.mockReset();
  mocks.retryJob.mockReset();
  mocks.getJob.mockReset();
});

describe("document jobs route", () => {
  it("requires a job id for status reads", async () => {
    const response = await GET(new Request("http://localhost/api/documents/jobs"));

    expect(response.status).toBe(400);
    expect(mocks.getJob).not.toHaveBeenCalled();
  });

  it("returns 401 when signed out", async () => {
    mocks.getSupabaseUser.mockResolvedValue(null);

    const response = await GET(
      new Request(`http://localhost/api/documents/jobs?id=${JOB_ID}`),
    );

    expect(response.status).toBe(401);
    expect(mocks.getJob).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown job", async () => {
    mocks.getJob.mockResolvedValue(null);

    const response = await GET(
      new Request(`http://localhost/api/documents/jobs?id=${JOB_ID}`),
    );

    expect(response.status).toBe(404);
  });

  it("returns an owner-scoped job", async () => {
    const job = { id: JOB_ID, status: "queued", stage: "queued" };
    mocks.getJob.mockResolvedValue(job);

    const response = await GET(
      new Request(`http://localhost/api/documents/jobs?id=${JOB_ID}`),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ job });
    expect(mocks.getJob).toHaveBeenCalledWith({
      jobId: JOB_ID,
      ownerId: "user-1",
      supabase: {},
    });
  });

  it("rejects malformed request bodies", async () => {
    const response = await POST(
      new Request("http://localhost/api/documents/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.processJobs).not.toHaveBeenCalled();
  });

  it("rejects an empty retry request", async () => {
    const response = await POST(jobRequest({}));

    expect(response.status).toBe(400);
    expect(mocks.retryJob).not.toHaveBeenCalled();
    expect(mocks.processJobs).not.toHaveBeenCalled();
  });

  it("retries a failed job without processing the queue inline", async () => {
    mocks.retryJob.mockResolvedValue(true);

    const response = await POST(jobRequest({ jobId: JOB_ID }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ retriedJob: true });
    expect(mocks.retryJob).toHaveBeenCalledWith({
      jobId: JOB_ID,
      ownerId: "user-1",
      supabase: {},
    });
    expect(mocks.processJobs).not.toHaveBeenCalled();
  });

  it("returns 404 when no failed job matches the retry request", async () => {
    mocks.retryJob.mockResolvedValue(false);

    const response = await POST(jobRequest({ jobId: JOB_ID }));

    expect(response.status).toBe(404);
    expect(mocks.processJobs).not.toHaveBeenCalled();
  });

  it("hides job processing outside Supabase mode", async () => {
    mocks.getAuthMode.mockReturnValue("local");

    const response = await POST(jobRequest({}));

    expect(response.status).toBe(404);
    expect(mocks.processJobs).not.toHaveBeenCalled();
  });
});
