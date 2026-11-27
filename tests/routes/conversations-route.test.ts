import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConfig: vi.fn(),
  getCurrentAccount: vi.fn(),
  list: vi.fn(),
  listMessages: vi.fn(),
  upsert: vi.fn(),
  delete: vi.fn(),
  deleteAll: vi.fn(),
  supabaseList: vi.fn(),
  supabaseListMessages: vi.fn(),
  supabaseUpsert: vi.fn(),
  supabaseDelete: vi.fn(),
  supabaseDeleteAll: vi.fn(),
  pgliteList: vi.fn(),
  pgliteListMessages: vi.fn(),
  pgliteUpsert: vi.fn(),
  pgliteDelete: vi.fn(),
  pgliteDeleteAll: vi.fn(),
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/modules/auth/auth-mode", () => ({
  getProviderConfig: mocks.getProviderConfig,
}));
vi.mock("@/modules/auth/current-account", () => ({
  getCurrentAccount: mocks.getCurrentAccount,
}));
vi.mock("@/modules/chat/local-conversation-store", () => ({
  listLocalConversations: mocks.list,
  upsertLocalConversation: mocks.upsert,
  deleteLocalConversation: mocks.delete,
  deleteAllLocalConversations: mocks.deleteAll,
}));
vi.mock("@/modules/chat/supabase-conversation-repository", () => ({
  createSupabaseConversationRepository: () => ({
    list: mocks.supabaseList,
    listMessages: mocks.supabaseListMessages,
    upsert: mocks.supabaseUpsert,
    delete: mocks.supabaseDelete,
    deleteAll: mocks.supabaseDeleteAll,
  }),
}));
vi.mock("@/modules/chat/pglite-conversation-repository", () => ({
  createPgliteConversationRepository: () => ({
    list: mocks.pgliteList,
    listMessages: mocks.pgliteListMessages,
    upsert: mocks.pgliteUpsert,
    delete: mocks.pgliteDelete,
    deleteAll: mocks.pgliteDeleteAll,
  }),
}));
vi.mock("@/modules/auth/supabase-server", () => ({
  createSupabaseServerClient: mocks.createSupabaseServerClient,
}));

import { DELETE, GET, POST, PUT } from "@/app/api/conversations/route";

const account = {
  id: "account-1",
  email: "alice@example.com",
  displayName: "Alice",
  avatarUrl: null,
};

const conversation = {
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  title: "Notes",
  updatedAt: 1,
};

const message = {
  id: "aaaaaaaa-0000-4000-8000-000000000011",
  role: "user",
  content: "Question",
  status: "done",
  createdAt: 2,
};

function updateRequest(body: unknown): Request {
  return new Request("http://localhost/api/conversations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.getProviderConfig.mockReturnValue({
    configured: true,
    auth: "local",
    database: "local",
  });
  mocks.getCurrentAccount.mockResolvedValue({ account, authProvider: "local" });
  mocks.createSupabaseServerClient.mockResolvedValue({});
  mocks.list.mockReset();
  mocks.listMessages.mockReset();
  mocks.upsert.mockReset();
  mocks.delete.mockReset();
  mocks.deleteAll.mockReset();
  mocks.supabaseList.mockReset();
  mocks.supabaseListMessages.mockReset();
  mocks.supabaseUpsert.mockReset();
  mocks.supabaseDelete.mockReset();
  mocks.supabaseDeleteAll.mockReset();
  mocks.pgliteList.mockReset();
  mocks.pgliteListMessages.mockReset();
  mocks.pgliteUpsert.mockReset();
  mocks.pgliteDelete.mockReset();
  mocks.pgliteDeleteAll.mockReset();
});

describe("conversations route contract", () => {
  it("returns 404 when providers are not configured", async () => {
    mocks.getProviderConfig.mockReturnValue({
      configured: false,
      auth: "unconfigured",
      database: "unconfigured",
      reason: "not configured",
    });

    const response = await GET();

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Conversation storage is disabled.",
    });
  });

  it("returns 401 when signed out", async () => {
    mocks.getCurrentAccount.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Sign in to load your conversations.",
    });
  });

  it("loads conversations from the local store for the signed-in account", async () => {
    mocks.list.mockResolvedValue([conversation]);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ conversations: [{ ...conversation, messages: [] }] });
    expect(mocks.list).toHaveBeenCalledWith("account-1");
    expect(mocks.supabaseList).not.toHaveBeenCalled();
  });

  it("loads conversations from Supabase when the database provider is supabase", async () => {
    mocks.getProviderConfig.mockReturnValue({
      configured: true,
      auth: "supabase",
      database: "supabase",
    });
    mocks.getCurrentAccount.mockResolvedValue({ account, authProvider: "supabase" });
    mocks.supabaseList.mockResolvedValue([conversation]);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ conversations: [{ ...conversation, messages: [] }] });
    expect(mocks.supabaseList).toHaveBeenCalledWith("account-1");
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.createSupabaseServerClient).toHaveBeenCalled();
  });

  it("loads conversations from embedded PostgreSQL when the database provider is postgres", async () => {
    mocks.getProviderConfig.mockReturnValue({
      configured: true,
      auth: "local",
      database: "postgres",
    });
    mocks.pgliteList.mockResolvedValue([conversation]);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ conversations: [{ ...conversation, messages: [] }] });
    expect(mocks.pgliteList).toHaveBeenCalledWith("account-1");
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("loads messages for a single conversation without loading the history", async () => {
    mocks.list.mockResolvedValue([{ ...conversation, messages: [message] }]);
    mocks.listMessages.mockResolvedValue([message]);

    const response = await GET(
      new Request(`http://localhost/api/conversations?id=${conversation.id}`),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ messages: [message] });
    expect(mocks.list).toHaveBeenCalledWith("account-1");
  });

  it("rejects a non-UUID conversation id for message reads", async () => {
    const response = await GET(
      new Request("http://localhost/api/conversations?id=not-a-uuid"),
    );

    expect(response.status).toBe(400);
    expect(mocks.listMessages).not.toHaveBeenCalled();
  });

  it("saves only supplied messages for the signed-in conversation", async () => {
    mocks.upsert.mockResolvedValue(undefined);

    const response = await POST(
      updateRequest({
        ownerId: "account-1",
        conversation,
        messages: [{ message, sequence: 0 }],
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ saved: 1 });
    expect(mocks.upsert).toHaveBeenCalledWith("account-1", {
      conversation: { ...conversation, messages: [] },
      messages: [{ message, sequence: 0 }],
    });
  });

  it("saves to Supabase when the database provider is supabase", async () => {
    mocks.getProviderConfig.mockReturnValue({
      configured: true,
      auth: "supabase",
      database: "supabase",
    });
    mocks.getCurrentAccount.mockResolvedValue({ account, authProvider: "supabase" });
    mocks.supabaseUpsert.mockResolvedValue(undefined);

    const response = await POST(
      updateRequest({ ownerId: "account-1", conversation, messages: [{ message, sequence: 0 }] }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ saved: 1 });
    expect(mocks.supabaseUpsert).toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("saves to embedded PostgreSQL when the database provider is postgres", async () => {
    mocks.getProviderConfig.mockReturnValue({
      configured: true,
      auth: "local",
      database: "postgres",
    });
    mocks.pgliteUpsert.mockResolvedValue(undefined);

    const response = await POST(
      updateRequest({ ownerId: "account-1", conversation, messages: [{ message, sequence: 0 }] }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ saved: 1 });
    expect(mocks.pgliteUpsert).toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.supabaseUpsert).not.toHaveBeenCalled();
  });

  it("rejects a spoofed owner with 403", async () => {
    const response = await POST(
      updateRequest({ ownerId: "account-2", conversation, messages: [{ message, sequence: 0 }] }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "The conversation owner does not match the signed-in account.",
    });
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.supabaseUpsert).not.toHaveBeenCalled();
  });

  it("rejects an invalid conversation update with 400", async () => {
    const response = await POST(updateRequest({ ownerId: "account-1", conversation, messages: [{}] }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "The conversation list contains invalid data.",
    });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("maps a storage failure to 500", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.upsert.mockRejectedValue(new Error("disk full"));

    const response = await POST(
      updateRequest({ ownerId: "account-1", conversation, messages: [{ message, sequence: 0 }] }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Conversation changes could not be saved.",
    });
    error.mockRestore();
  });

  it("deletes only an explicitly selected conversation", async () => {
    const conversationId = "aaaaaaaa-0000-4000-8000-000000000001";
    const response = await DELETE(
      new Request(`http://localhost/api/conversations?id=${conversationId}`, { method: "DELETE" }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ deleted: true });
    expect(mocks.delete).toHaveBeenCalledWith("account-1", conversationId);
  });

  it("deletes all conversations for the signed-in account", async () => {
    mocks.deleteAll.mockResolvedValue(undefined);
    const response = await PUT(
      new Request("http://localhost/api/conversations", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ownerId: "account-1", conversations: [] }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ deleted: true });
    expect(mocks.deleteAll).toHaveBeenCalledWith("account-1");
  });
});
