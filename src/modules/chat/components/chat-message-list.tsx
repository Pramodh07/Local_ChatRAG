"use client";

import dynamic from "next/dynamic";
import { Children, isValidElement, memo, useState, type ReactElement, type ReactNode, type RefObject } from "react";
import {
  ArrowUpRight,
  Check,
  Copy,
  Database,
  FileText,
  Logo,
  Quote,
  Refresh,
  Sparkle,
  Table,
} from "@/modules/shared/components/icons";
import { SUGGESTIONS } from "@/modules/chat/suggestions";
import type { Message, Stage } from "@/modules/chat/types";
import { Notice } from "@/modules/shared/components/ui/notice";
import { Tooltip } from "@/modules/shared/components/ui/tooltip";
import { formatCount } from "@/modules/shared/lib/utils";

const MarkdownContent = dynamic(
  async () => {
    const [{ default: ReactMarkdown }, { default: remarkGfm }] = await Promise.all([
      import("react-markdown"),
      import("remark-gfm"),
    ]);
    return function RenderMarkdown({ content }: { content: string }) {
      return (
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            pre: ({ children }) => {
              const code = Children.toArray(children).find(isCodeElement);
              if (!code) return <pre>{children}</pre>;
              const language = code.props.className?.match(/language-([\w-]+)/)?.[1];
              const source = Children.toArray(code.props.children).map((part) =>
                typeof part === "string" ? part : "",
              ).join("");
              return <MarkdownCodeBlock code={source} language={language} />;
            },
          }}
        >
          {content}
        </ReactMarkdown>
      );
    };
  },
  {
    ssr: false,
    loading: () => (
      <div className="space-y-2" role="status" aria-label="Rendering response">
        <div className="skeleton h-3.5 w-11/12" />
        <div className="skeleton h-3.5 w-4/5" />
        <div className="skeleton h-3.5 w-2/3" />
      </div>
    ),
  },
);

function isCodeElement(value: ReactNode): value is ReactElement<{ className?: string; children?: ReactNode }> {
  return isValidElement(value) && value.type === "code";
}

function MarkdownCodeBlock({ code, language }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setCopyError(false);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopyError(true);
    }
  }

  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-[var(--code-bg)]">
      <div className="flex items-center justify-between border-b border-line px-3 py-2 text-xs text-muted">
        <span>{language ?? "Code"}</span>
        <button
          type="button"
          onClick={() => void copyCode()}
          className="min-h-8 rounded-[var(--radius-control)] px-2 text-xs transition-colors hover:bg-raised hover:text-ink"
          aria-label="Copy code block"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="m-0 overflow-x-auto p-4">
        <code className="whitespace-pre font-mono text-sm leading-6">{code}</code>
      </pre>
      {copyError && <p className="px-3 pb-2 text-xs text-danger" role="status">Code could not be copied.</p>}
    </div>
  );
}

const stageLabels: Record<Stage, string> = {
  retrieving: "Searching your documents",
  done: "Complete",
};

type ChatMessageListProps = {
  messages: Message[];
  bottomRef: RefObject<HTMLDivElement | null>;
  /** Short status text to announce (e.g. "Searching your documents…"). */
  announcement?: string;
  copiedMessageId: string | null;
  onCopyMessage: (message: Message) => void;
  onRegenerate: () => void;
  onSuggestion: (prompt: string) => void;
  onOpenSources: (citationId: number) => void;
};

function SuggestionIcon({ icon }: { icon: string }) {
  const Icon =
    icon === "file" ? FileText : icon === "database" ? Database : icon === "table" ? Table : Sparkle;
  return <Icon size={16} />;
}

type ChatMessageItemProps = {
  message: Message;
  isCopied: boolean;
  onCopyMessage: (message: Message) => void;
  onRegenerate: () => void;
  onOpenSources: (citationId: number) => void;
};

const ChatMessageItem = memo(function ChatMessageItem({
  message,
  isCopied,
  onCopyMessage,
  onRegenerate,
  onOpenSources,
}: ChatMessageItemProps) {
  return (
    <article
      className={message.role === "user" ? "flex justify-end" : "group flex gap-3"}
    >
      {message.role === "user" ? (
        <div className="max-w-[80%] rounded-[var(--radius-card)] bg-raised px-4 py-2.5 text-base leading-[1.6] text-ink">
          {message.content}
        </div>
      ) : (
        <>
          <span className="mt-0.5 hidden h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-line bg-[var(--surface-solid)] sm:flex">
            <Logo className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            {message.status === "streaming" && message.content === "" ? (
              <div className="flex items-center gap-2.5 rounded-xl border border-line bg-[var(--surface-solid)] px-3.5 py-2.5 text-[12px] text-muted">
                <div className="flex gap-1">
                  <span className="dot h-1.5 w-1.5 rounded-full bg-accent" />
                  <span className="dot h-1.5 w-1.5 rounded-full bg-accent [animation-delay:150ms]" />
                  <span className="dot h-1.5 w-1.5 rounded-full bg-accent [animation-delay:300ms]" />
                </div>
                {stageLabels[message.stage ?? "retrieving"]}…
              </div>
            ) : message.status === "error" ? (
              <div className="space-y-3">
                <Notice tone="error">{message.content}</Notice>
                <button
                  type="button"
                  onClick={onRegenerate}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-[var(--surface-solid)] px-2.5 py-1.5 text-[11.5px] font-medium text-muted transition-colors hover:text-ink"
                >
                  <Refresh size={13} /> Try again
                </button>
              </div>
            ) : (
              <div className="prose-chat animate-fade-up">
                <MarkdownContent content={message.content} />
                {message.status === "streaming" && (
                  <span className="animate-caret ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] bg-accent" />
                )}
              </div>
            )}

            {message.citations && message.citations.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {message.citations.slice(0, 6).map((citation) => (
                  <a
                    key={citation.id}
                    href={`#cite-${citation.id}`}
                    onClick={(event) => {
                      event.preventDefault();
                      onOpenSources(citation.id);
                    }}
                    className="inline-flex max-w-[240px] items-center gap-1.5 rounded-lg border border-line bg-raised px-2 py-1 text-[11px] text-muted transition-colors hover:border-accent/30 hover:text-ink"
                    title={citation.doc}
                  >
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-accent-soft font-mono text-[9px] font-semibold text-accent-ink">
                      {citation.id}
                    </span>
                    <span className="truncate">{citation.doc}</span>
                  </a>
                ))}
              </div>
            )}

            {message.status !== "streaming" && message.content && (
              <div className="mt-3 flex items-center gap-0.5 text-faint">
                <Tooltip
                  id={`copy-response-${message.id}`}
                  content={isCopied ? "Copied" : "Copy response"}
                >
                  <button
                    className="rounded-md p-1.5 transition-colors hover:bg-raised hover:text-ink"
                    aria-label={isCopied ? "Copied" : "Copy response"}
                    onClick={() => onCopyMessage(message)}
                  >
                    {isCopied ? <Check size={14} className="text-ok" /> : <Copy size={14} />}
                  </button>
                </Tooltip>
                <Tooltip id={`regenerate-response-${message.id}`} content="Regenerate response">
                  <button
                    className="rounded-md p-1.5 transition-colors hover:bg-raised hover:text-ink"
                    aria-label="Regenerate response"
                    onClick={onRegenerate}
                  >
                    <Refresh size={14} />
                  </button>
                </Tooltip>
                <span className="ml-1 text-[10.5px] text-faint">
                  {message.status === "stopped" ? "Stopped" : "Generated"}
                </span>
                {message.tokens !== undefined && (
                  <span className="ml-auto inline-flex items-center gap-1 font-mono text-[10px] tabular-nums text-faint">
                    <Quote size={11} />
                    {formatCount(message.tokens)} tokens
                  </span>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </article>
  );
});

export const ChatMessageList = memo(function ChatMessageList({
  messages,
  bottomRef,
  announcement,
  copiedMessageId,
  onCopyMessage,
  onRegenerate,
  onSuggestion,
  onOpenSources,
}: ChatMessageListProps) {
  return (
    <div className="scroll-slim relative flex-1 overflow-y-auto">
      {/* Only the short status string is announced; re-rendering the transcript
          must not re-announce the whole conversation. */}
      <div className="sr-only" role="status" aria-live="polite">
        {announcement ?? ""}
      </div>
      <div className="mx-auto w-full max-w-[720px] px-4 py-6 sm:px-6">
        {messages.length === 0 ? (
          <div className="flex min-h-[calc(100dvh-14rem)] flex-col justify-center py-6">
            <div className="mb-8">
              <h1 className="text-2xl font-semibold leading-tight tracking-[-0.03em] text-ink">
                Ask your documents
              </h1>
              <p className="mt-2 max-w-md text-base leading-6 text-muted">
                Ask a question and Atlas will search your indexed documents, then answer with
                citations you can verify.
              </p>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion.title}
                  onClick={() => onSuggestion(suggestion.prompt)}
                  className="group flex min-h-20 items-start gap-3 rounded-[var(--radius-card)] border border-line bg-surface-solid p-4 text-left transition-colors duration-normal hover:bg-raised"
                >
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-accent-soft text-accent-ink">
                    <SuggestionIcon icon={suggestion.icon} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium leading-5 text-ink">
                      {suggestion.title}
                    </span>
                    <span className="mt-0.5 block text-[11.5px] leading-5 text-muted">
                      {suggestion.hint}
                    </span>
                  </span>
                  <ArrowUpRight
                    size={14}
                    className="mt-1 shrink-0 text-faint opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                  />
                </button>
              ))}
            </div>

            <p className="mt-6 text-xs text-faint">
              Tip: attach a PDF, Markdown, or text file from the composer to index it.
            </p>
          </div>
        ) : (
          <div className="space-y-7 pb-8">
            {messages.map((message) => (
              <ChatMessageItem
                key={message.id}
                message={message}
                isCopied={copiedMessageId === message.id}
                onCopyMessage={onCopyMessage}
                onRegenerate={onRegenerate}
                onOpenSources={onOpenSources}
              />
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>
    </div>
  );
});
