// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { addToOutbox, outboxKey, readOutbox, removeFromOutbox } from "@/modules/chat/save-outbox";
import type { ConversationUpdate } from "@/modules/chat/conversation-diff";

const update = (id: string): ConversationUpdate => ({
  snapshot: { id, title: "Chat", messages: [], updatedAt: 1 },
  conversation: { id, title: "Chat", messages: [], updatedAt: 1 },
  messages: [
    {
      message: { id: `m-${id}`, role: "user", content: "hello", status: "done", createdAt: 1 },
      sequence: 0,
    },
  ],
});

describe("save outbox", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("adds, reads and removes entries by key", () => {
    const owner = "owner-1";
    addToOutbox(owner, [update("c1"), update("c2")]);
    expect(readOutbox()).toHaveLength(2);

    const key = outboxKey(owner, update("c1"));
    removeFromOutbox([key]);
    expect(readOutbox().map((entry) => entry.key)).toEqual([outboxKey(owner, update("c2"))]);
  });

  it("coalesces repeated writes for the same messages", () => {
    const owner = "owner-1";
    addToOutbox(owner, [update("c1")]);
    addToOutbox(owner, [update("c1")]);
    expect(readOutbox()).toHaveLength(1);
  });

  it("returns an empty outbox when storage contains invalid JSON", () => {
    localStorage.setItem("atlas-save-outbox", "{not json");
    expect(readOutbox()).toEqual([]);
  });
});
