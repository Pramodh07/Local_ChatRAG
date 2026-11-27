import { describe, expect, it } from "vitest";
import { collectConversationUpdates } from "@/modules/chat/conversation-diff";
import type { Conversation, Message } from "@/modules/chat/types";

function message(overrides: Partial<Message> & Pick<Message, "id">): Message {
  return {
    role: "user",
    content: "",
    status: "done",
    createdAt: 1,
    ...overrides,
  };
}

function conversation(
  overrides: Partial<Conversation> & Pick<Conversation, "id">,
): Conversation {
  return {
    title: "Chat",
    messages: [],
    updatedAt: 1,
    ...overrides,
  };
}

describe("collectConversationUpdates", () => {
  it("returns no writes when the transcript is unchanged", () => {
    const stored = conversation({
      id: "c1",
      messages: [message({ id: "m1" }), message({ id: "m2", role: "assistant" })],
    });

    expect(
      collectConversationUpdates([stored], new Map([[stored.id, stored]])),
    ).toEqual([]);
  });

  it("writes only the appended message with its sequence", () => {
    const first = message({ id: "m1" });
    const previous = conversation({ id: "c1", messages: [first] });
    const appended = message({ id: "m2", role: "assistant" });
    const current = { ...previous, messages: [first, appended] };

    const updates = collectConversationUpdates(
      [current],
      new Map([[previous.id, previous]]),
    );

    expect(updates).toHaveLength(1);
    expect(updates[0]?.messages).toEqual([{ message: appended, sequence: 1 }]);
  });

  it("writes an edited message in place", () => {
    const original = message({ id: "m1", content: "draft" });
    const previous = conversation({ id: "c1", messages: [original] });
    const edited = { ...original, content: "final" };
    const current = { ...previous, messages: [edited] };

    const updates = collectConversationUpdates(
      [current],
      new Map([[previous.id, previous]]),
    );

    expect(updates[0]?.messages).toEqual([{ message: edited, sequence: 0 }]);
  });

  it("writes both positions when messages are reordered", () => {
    const first = message({ id: "m1", content: "one" });
    const second = message({ id: "m2", content: "two" });
    const previous = conversation({ id: "c1", messages: [first, second] });
    const current = { ...previous, messages: [second, first] };

    const updates = collectConversationUpdates(
      [current],
      new Map([[previous.id, previous]]),
    );

    expect(updates[0]?.messages).toEqual([
      { message: second, sequence: 0 },
      { message: first, sequence: 1 },
    ]);
  });

  it("emits a metadata-only update when only the title changes", () => {
    const stored = conversation({ id: "c1", title: "Old" });
    const current = { ...stored, title: "New", updatedAt: 2 };

    const updates = collectConversationUpdates(
      [current],
      new Map([[stored.id, stored]]),
    );

    expect(updates).toHaveLength(1);
    expect(updates[0]?.messages).toEqual([]);
    expect(updates[0]?.snapshot).toBe(current);
  });

  it("skips untouched conversations", () => {
    const unchanged = conversation({ id: "c1" });
    const previous = conversation({ id: "c2", title: "Old" });
    const current = { ...previous, title: "New" };

    const updates = collectConversationUpdates(
      [unchanged, current],
      new Map([
        [unchanged.id, unchanged],
        [previous.id, previous],
      ]),
    );

    expect(updates.map((update) => update.conversation.id)).toEqual(["c2"]);
  });
});
