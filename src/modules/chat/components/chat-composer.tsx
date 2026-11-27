"use client";

import { memo, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { ArrowUp, Paperclip, Spinner, Square, X } from "@/modules/shared/components/icons";
import { cn } from "@/modules/shared/lib/utils";

export type UploadStatus = {
  message: string;
  error: boolean;
};

type ChatComposerProps = {
  isGenerating: boolean;
  isUploading: boolean;
  uploadStatus: UploadStatus | null;
  uploadsEnabled?: boolean;
  onSend: (message: string) => void;
  onStop: () => void;
  onFileSelected: (file: File) => void;
  onDismissUpload?: () => void;
};

export const ChatComposer = memo(function ChatComposer({
  isGenerating,
  isUploading,
  uploadStatus,
  uploadsEnabled = true,
  onSend,
  onStop,
  onFileSelected,
  onDismissUpload,
}: ChatComposerProps) {
  const [value, setValue] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 168)}px`;
  }, [value]);

  function sendMessage() {
    const message = value.trim();
    if (!message || isGenerating) return;
    setValue("");
    onSend(message);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    sendMessage();
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) onFileSelected(file);
    event.target.value = "";
  }

  const canSend = value.trim().length > 0 && !isGenerating;

  return (
    <div className="shrink-0 px-3 pb-3 sm:px-6 sm:pb-5">
      <form onSubmit={handleSubmit} className="mx-auto max-w-[840px]">
        {uploadStatus && (
          <div
            className={cn(
              "mb-2 flex items-start gap-2 rounded-xl border px-3 py-2 text-[11.5px] leading-5",
              uploadStatus.error
                ? "border-danger/30 bg-danger/10 text-danger"
                : "border-line bg-raised text-muted",
            )}
            role={uploadStatus.error ? "alert" : "status"}
          >
            {isUploading ? (
              <Spinner size={13} className="mt-0.5 shrink-0 animate-spin text-accent" />
            ) : (
              <Paperclip size={13} className="mt-0.5 shrink-0" />
            )}
            <span className="min-w-0 flex-1">{uploadStatus.message}</span>
            {!isUploading && onDismissUpload && (
              <button
                type="button"
                onClick={onDismissUpload}
                aria-label="Dismiss upload status"
                className="rounded p-0.5 opacity-70 hover:opacity-100"
              >
                <X size={12} />
              </button>
            )}
          </div>
        )}

        <div className="rounded-[var(--radius-container)] border border-line bg-surface-solid p-1.5 transition-[border-color,box-shadow] duration-normal focus-within:border-accent/60 focus-within:ring-2 focus-within:ring-accent/15">
          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                sendMessage();
              }
            }}
            placeholder="Ask about your documents…"
            aria-label="Message Atlas"
            className="max-h-42 min-h-11 w-full resize-none bg-transparent px-3 py-2.5 text-[13.5px] leading-6 text-ink outline-none placeholder:text-faint"
          />
          <div className="flex items-center justify-between gap-2 px-0.5 pb-0.5">
            <div className="flex items-center gap-1">
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.txt,.md,.markdown,application/pdf,text/plain,text/markdown"
                className="hidden"
                onChange={handleFileChange}
              />
              <button
                type="button"
                disabled={isUploading || !uploadsEnabled}
                title={uploadsEnabled ? undefined : "Document uploads require Supabase"}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[11.5px] font-medium text-muted transition-colors hover:bg-raised hover:text-ink disabled:pointer-events-none disabled:opacity-50"
                aria-label={uploadsEnabled ? "Attach and index a document" : "Document uploads require Supabase"}
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip size={15} />
                <span className="hidden sm:inline">{isUploading ? "Indexing…" : "Attach"}</span>
              </button>
              <span className="hidden text-[10.5px] text-faint md:inline">
                {uploadsEnabled ? "PDF, Markdown, or text" : "Uploads need Supabase"}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span className="hidden text-[10.5px] text-faint sm:inline">
                Enter to send · Shift+Enter for a new line
              </span>
              {isGenerating ? (
                <button
                  type="button"
                  onClick={onStop}
                  className="flex h-8 items-center gap-1.5 rounded-lg border border-line bg-[var(--surface-solid)] px-2.5 text-[11.5px] font-medium text-ink transition-colors hover:bg-raised"
                  aria-label="Stop generating"
                >
                  <Square size={11} />
                  Stop
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!canSend}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-[var(--surface-solid)] transition-[filter,opacity] duration-normal hover:brightness-105 disabled:pointer-events-none disabled:opacity-40"
                  aria-label="Send message"
                >
                  <ArrowUp size={16} />
                </button>
              )}
            </div>
          </div>
        </div>

        <p className="mt-2 text-center text-[10.5px] leading-4 text-faint">
          Atlas answers from your indexed documents. Verify important details before relying on them.
        </p>
      </form>
    </div>
  );
});
