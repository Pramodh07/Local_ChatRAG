import { describe, expect, it } from "vitest";
import { parseConversationList } from "@/modules/chat/conversation-validation";

const CONVERSATION_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const MESSAGE_ID = "aaaaaaaa-0000-4000-8000-000000000011";

const validConversation = {
  id: CONVERSATION_ID,
  title: "Project notes",
  messages: [
    {
      id: MESSAGE_ID,
      role: "user",
      content: "Summarize the document.",
      status: "done",
      createdAt: 1,
    },
  ],
  updatedAt: 1,
};

describe("parseConversationList", () => {
  it("accepts valid conversations", () => {
    expect(parseConversationList([validConversation])).toEqual([validConversation]);
  });

  it("rejects duplicate IDs and invalid message data", () => {
    expect(parseConversationList([validConversation, validConversation])).toBeNull();
    expect(
      parseConversationList([
        {
          ...validConversation,
          messages: [{ ...validConversation.messages[0], role: "system" }],
        },
      ]),
    ).toBeNull();
  });

  it("rejects non-UUID conversation and message IDs", () => {
    expect(parseConversationList([{ ...validConversation, id: "conversation-1" }])).toBeNull();
    expect(
      parseConversationList([
        {
          ...validConversation,
          messages: [{ ...validConversation.messages[0], id: "message-1" }],
        },
      ]),
    ).toBeNull();
    // A UUID-shaped id with an invalid variant nibble must be rejected too.
    expect(
      parseConversationList([{ ...validConversation, id: "aaaaaaaa-0000-4000-c000-000000000001" }]),
    ).toBeNull();
  });
});
