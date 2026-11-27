import { describe, expect, it } from "vitest";
import {
  CHAT_VALIDATION_MESSAGE,
  parseChatRequest,
} from "@/modules/chat/chat-request";
import { DEFAULT_CHAT_RUNTIME_SETTINGS } from "@/modules/chat/runtime-settings";
import {
  CONVERSATION_OWNER_MISMATCH_MESSAGE,
  INVALID_CONVERSATION_DATA_MESSAGE,
  INVALID_CONVERSATION_LIST_MESSAGE,
  parseConversationSavePayload,
} from "@/modules/chat/conversation-payload";
import {
  EMPTY_PREFERENCE_MESSAGE,
  PROVIDER_MODEL_PAIR_MESSAGE,
  UNSUPPORTED_PREFERENCE_MESSAGE,
  parsePreferenceUpdate,
} from "@/modules/account/preferences-payload";

const validConversation = {
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  title: "Project notes",
  messages: [],
  updatedAt: 1,
};

describe("parseChatRequest", () => {
  it("trims the message and defaults history to an empty list", () => {
    expect(parseChatRequest({ message: "  hello  " })).toEqual({
      message: "hello",
      history: [],
    });
  });

  it("preserves valid history turns", () => {
    expect(
      parseChatRequest({
        message: "question",
        history: [
          { role: "user", content: "earlier" },
          { role: "assistant", content: "answer" },
        ],
      }),
    ).toEqual({
      message: "question",
      history: [
        { role: "user", content: "earlier" },
        { role: "assistant", content: "answer" },
      ],
    });
  });

  it("rejects empty, oversized, and malformed messages", () => {
    expect(parseChatRequest({ message: "   " })).toBeNull();
    expect(parseChatRequest({ message: "x".repeat(4001) })).toBeNull();
    expect(parseChatRequest({ message: 42 })).toBeNull();
    expect(parseChatRequest(null)).toBeNull();
    expect(CHAT_VALIDATION_MESSAGE).toContain("1–4,000 characters");
  });

  it("rejects too many or invalid history turns", () => {
    expect(
      parseChatRequest({
        message: "question",
        history: Array.from({ length: 9 }, () => ({ role: "user", content: "x" })),
      }),
    ).toBeNull();

    expect(
      parseChatRequest({ message: "question", history: [{ role: "system", content: "x" }] }),
    ).toBeNull();
    expect(
      parseChatRequest({ message: "question", history: [{ role: "user", content: "x".repeat(4001) }] }),
    ).toBeNull();
  });

  it("accepts bounded runtime settings and rejects invalid settings", () => {
    expect(parseChatRequest({ message: "question", settings: DEFAULT_CHAT_RUNTIME_SETTINGS })).toEqual({
      message: "question",
      history: [],
      settings: DEFAULT_CHAT_RUNTIME_SETTINGS,
    });
    expect(parseChatRequest({ message: "question", settings: { ...DEFAULT_CHAT_RUNTIME_SETTINGS, topK: 100 } })).toBeNull();
  });

  it("preserves an optional provider and model selection", () => {
    expect(
      parseChatRequest({
        message: "question",
        provider: "anthropic",
        model: "  claude-sonnet-5-5  ",
      }),
    ).toEqual({
      message: "question",
      history: [],
      provider: "anthropic",
      model: "claude-sonnet-5-5",
    });
  });

  it("rejects an unsupported provider or malformed model name", () => {
    expect(parseChatRequest({ message: "question", provider: "mistral" })).toBeNull();
    expect(parseChatRequest({ message: "question", model: "  " })).toBeNull();
    expect(parseChatRequest({ message: "question", model: "x\ny" })).toBeNull();
    expect(parseChatRequest({ message: "question", model: "m".repeat(201) })).toBeNull();
  });
});

describe("parseConversationSavePayload", () => {
  it("returns the parsed list when the owner matches", () => {
    const result = parseConversationSavePayload(
      { ownerId: "account-1", conversations: [validConversation] },
      "account-1",
    );
    expect(result).toEqual({ ok: true, value: [validConversation] });
  });

  it("rejects a spoofed owner with 403", () => {
    const result = parseConversationSavePayload(
      { ownerId: "account-2", conversations: [validConversation] },
      "account-1",
    );
    expect(result).toEqual({
      ok: false,
      status: 403,
      message: CONVERSATION_OWNER_MISMATCH_MESSAGE,
    });
  });

  it("rejects malformed payloads and invalid conversation data", () => {
    expect(parseConversationSavePayload({ conversations: [] }, "account-1")).toEqual({
      ok: false,
      status: 400,
      message: INVALID_CONVERSATION_LIST_MESSAGE,
    });
    expect(
      parseConversationSavePayload({ ownerId: "account-1", conversations: [{}] }, "account-1"),
    ).toEqual({
      ok: false,
      status: 400,
      message: INVALID_CONVERSATION_DATA_MESSAGE,
    });
  });

  it("rejects duplicate conversation IDs", () => {
    expect(
      parseConversationSavePayload(
        { ownerId: "account-1", conversations: [validConversation, validConversation] },
        "account-1",
      ),
    ).toEqual({
      ok: false,
      status: 400,
      message: INVALID_CONVERSATION_DATA_MESSAGE,
    });
  });
});

describe("parsePreferenceUpdate", () => {
  it("accepts a theme-only update", () => {
    expect(parsePreferenceUpdate({ theme: "dark" })).toEqual({
      ok: true,
      value: { theme: "dark" },
    });
  });

  it("accepts a provider and model pair and trims the model", () => {
    expect(
      parsePreferenceUpdate({ provider: "openai", model: "  gpt-6.2-sol  " }),
    ).toEqual({
      ok: true,
      value: { provider: "openai", model: "gpt-6.2-sol" },
    });
  });

  it("rejects an empty payload", () => {
    expect(parsePreferenceUpdate({})).toEqual({
      ok: false,
      status: 400,
      message: EMPTY_PREFERENCE_MESSAGE,
    });
  });

  it("rejects a provider without a model", () => {
    expect(parsePreferenceUpdate({ provider: "openai" })).toEqual({
      ok: false,
      status: 400,
      message: PROVIDER_MODEL_PAIR_MESSAGE,
    });
  });

  it("rejects unsupported fields", () => {
    expect(parsePreferenceUpdate({ theme: "dark", unknown: true })).toEqual({
      ok: false,
      status: 400,
      message: UNSUPPORTED_PREFERENCE_MESSAGE,
    });
  });

  it("uses the existing per-field messages", () => {
    expect(parsePreferenceUpdate({ theme: "blue" })).toEqual({
      ok: false,
      status: 400,
      message: "Theme must be dark or light.",
    });
    expect(parsePreferenceUpdate({ provider: "unknown", model: "x" })).toEqual({
      ok: false,
      status: 400,
      message: "Select a supported model provider.",
    });
    expect(parsePreferenceUpdate({ provider: "openai", model: "   " })).toEqual({
      ok: false,
      status: 400,
      message: "Select a valid model.",
    });
  });
});
