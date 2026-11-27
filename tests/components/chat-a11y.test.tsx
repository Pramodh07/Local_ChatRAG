// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatMessageList } from "@/modules/chat/components/chat-message-list";
import { SourcePanel } from "@/modules/chat/components/source-panel";
import type { Citation, Message } from "@/modules/chat/types";

const messages: Message[] = [
  {
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    role: "user",
    content: "Hello",
    status: "done",
    createdAt: 1,
  },
];

const citations: Citation[] = [
  {
    id: 1,
    doc: "notes.pdf",
    excerpt: "An excerpt",
    score: 0.9,
  },
];

describe("chat accessibility", () => {
  afterEach(() => cleanup());

  it("announces status without putting the whole transcript in a live region", () => {
    const { container } = render(
      <ChatMessageList
        messages={messages}
        bottomRef={createRef<HTMLDivElement>()}
        announcement="Generating a response."
        copiedMessageId={null}
        onCopyMessage={() => undefined}
        onRegenerate={() => undefined}
        onSuggestion={() => undefined}
        onOpenSources={() => undefined}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Generating a response.");
    expect(container.querySelector('[aria-live="polite"]')).toBe(screen.getByRole("status"));
  });

  it("closes the sources dialog on Escape", async () => {
    const onClose = vi.fn();
    render(<SourcePanel citations={citations} onClose={onClose} />);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
