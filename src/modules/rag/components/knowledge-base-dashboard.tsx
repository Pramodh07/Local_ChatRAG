"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import type { AccountInfo, AuthProvider } from "@/modules/auth/types";
import { AccountMenu } from "@/modules/auth/components/account-menu";
import { Button } from "@/modules/shared/components/ui/button";
import { Card, CardHeader } from "@/modules/shared/components/ui/card";
import { ConfirmDialog } from "@/modules/shared/components/ui/dialog";
import { Notice } from "@/modules/shared/components/ui/notice";
import { Skeleton } from "@/modules/shared/components/ui/skeleton";
import { Badge } from "@/modules/shared/components/ui/badge";
import { Database, FileText, Trash, Upload } from "@/modules/shared/components/icons";
import { errorMessageFromPayload } from "@/modules/shared/lib/http";
import { isRecord } from "@/modules/shared/lib/guards";
import {
  DOCUMENT_STATUSES,
  type DocumentRecord,
  type DocumentStatus,
} from "@/modules/rag/ingestion-types";
import { getStoredChatRuntimeSettings } from "@/modules/chat/runtime-settings";

const STATUS_LABEL: Record<DocumentStatus, string> = {
  queued: "Queued",
  processing: "Indexing",
  ready: "Ready",
  failed: "Failed",
};

const STATUS_TONE: Record<DocumentStatus, "neutral" | "success" | "warning" | "danger"> = {
  queued: "neutral",
  processing: "warning",
  ready: "success",
  failed: "danger",
};

function isDocumentRecord(value: unknown): value is DocumentRecord {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.mime_type === "string" &&
    typeof value.chunk_count === "number" &&
    Number.isSafeInteger(value.chunk_count) &&
    typeof value.status === "string" &&
    (DOCUMENT_STATUSES as readonly string[]).includes(value.status) &&
    (value.last_error === null || typeof value.last_error === "string") &&
    typeof value.created_at === "string" &&
    typeof value.updated_at === "string" &&
    (value.job_id === null || typeof value.job_id === "string") &&
    (value.job_status === null || typeof value.job_status === "string")
  );
}

const documentDateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown date" : documentDateFormatter.format(date);
}

function documentsEqual(left: DocumentRecord[], right: DocumentRecord[]) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const current = left[index];
    const next = right[index];
    if (!current || !next) return false;
    if (
      current.id !== next.id ||
      current.name !== next.name ||
      current.mime_type !== next.mime_type ||
      current.chunk_count !== next.chunk_count ||
      current.status !== next.status ||
      current.last_error !== next.last_error ||
      current.created_at !== next.created_at ||
      current.updated_at !== next.updated_at ||
      current.job_id !== next.job_id ||
      current.job_status !== next.job_status
    ) {
      return false;
    }
  }
  return true;
}

export function KnowledgeBaseDashboard({
  account,
  authProvider,
}: {
  account: AccountInfo;
  authProvider: AuthProvider;
}) {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [loading, setLoading] = useState(authProvider === "supabase");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<DocumentRecord | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadDocuments = useCallback(async (options?: { silent?: boolean }) => {
    if (authProvider !== "supabase") return [];
    if (!options?.silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const response = await fetch("/api/documents", { cache: "no-store" });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(errorMessageFromPayload(payload, "Documents could not be loaded."));
      if (!isRecord(payload) || !Array.isArray(payload.documents) || !payload.documents.every(isDocumentRecord)) {
        throw new Error("The document list response was invalid.");
      }
      const nextDocuments = payload.documents;
      setDocuments((current) =>
        documentsEqual(current, nextDocuments) ? current : nextDocuments,
      );
      return nextDocuments;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Documents could not be loaded.");
      return [];
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }, [authProvider]);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  const hasPendingDocuments = useMemo(
    () =>
      documents.some(
        (document) => document.status === "queued" || document.status === "processing",
      ),
    [documents],
  );

  // The worker is independent of the browser; this only refreshes visible job status.
  // Depends on the boolean, not the array: a fetch replaces `documents` on every
  // tick, so an array dependency would restart the effect and collapse the delay.
  useEffect(() => {
    if (!hasPendingDocuments) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    async function tick() {
      if (cancelled) return;
      await loadDocuments({ silent: true });
      attempt += 1;
      // Back off from 5s to 30s while a job stays pending; never poll in a tight loop.
      const delay = Math.min(2_500 * 2 ** Math.min(attempt, 4), 30_000);
      if (!cancelled) timer = setTimeout(tick, delay);
    }

    timer = setTimeout(tick, 1_000);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [hasPendingDocuments, loadDocuments]);

  async function uploadFile(file: File) {
    setUploading(true);
    setNotice(null);
    setError(null);
    const body = new FormData();
    body.set("file", file);

    try {
      const settings = getStoredChatRuntimeSettings(account.id);
      const response = await fetch("/api/documents", {
        method: "POST",
        headers: {
          "x-atlas-chunk-size": String(settings.chunkSize),
        },
        body,
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(errorMessageFromPayload(payload, "The document could not be queued."));
      if (!isRecord(payload) || !isRecord(payload.document)) {
        throw new Error("The upload response was invalid.");
      }

      const document = payload.document;
      setNotice(
        document.duplicate === true
          ? `${file.name} was already uploaded. Reusing its existing document.`
          : `Queued ${file.name} for indexing.`,
      );
      await loadDocuments();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "The document could not be queued.");
    } finally {
      setUploading(false);
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void uploadFile(file);
  }

  async function retryDocument(document: DocumentRecord) {
    if (!document.job_id) return;
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/documents/jobs", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ jobId: document.job_id }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(errorMessageFromPayload(payload, "The document could not be retried."));
      setNotice(`Retried ${document.name}.`);
      await loadDocuments();
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : "The document could not be retried.");
    }
  }

  async function deleteDocument(document: DocumentRecord) {
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/documents?id=${encodeURIComponent(document.id)}`, { method: "DELETE" });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(errorMessageFromPayload(payload, "The document could not be deleted."));
      setDocuments((current) => current.filter((item) => item.id !== document.id));
      setNotice(`Deleted ${document.name}.`);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "The document could not be deleted.");
    }
  }

  const readyCount = documents.filter((document) => document.status === "ready").length;

  return (
    <main className="min-h-dvh text-ink">
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-canvas px-4 sm:px-6">
        <Link href="/" className="text-sm font-semibold tracking-tight hover:text-accent-ink">
          Atlas
        </Link>
        <AccountMenu account={account} authProvider={authProvider} />
      </header>

      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Knowledge Base</h1>
          <p className="mt-1 text-base text-muted">Manage the documents Atlas can search and cite.</p>
        </div>

        {authProvider !== "supabase" ? (
          <Notice tone="info">
            Document indexing is available when Supabase authentication and storage are configured.
          </Notice>
        ) : (
          <>
            {error && (
              <div className="mb-4">
                <Notice tone="error" onDismiss={() => setError(null)}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span>{error}</span>
                    <Button size="sm" onClick={() => void loadDocuments()}>Retry</Button>
                  </div>
                </Notice>
              </div>
            )}
            {notice && (
              <div className="mb-4">
                <Notice tone="success" onDismiss={() => setNotice(null)}>{notice}</Notice>
              </div>
            )}

            <Card className="mb-6">
              <div className="p-5 sm:p-6">
                <CardHeader
                  icon={<Upload size={16} />}
                  title="Add documents"
                  description="Upload a PDF, Markdown, or plain-text file. Indexing runs in the background."
                />
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.txt,.md,.markdown,application/pdf,text/plain,text/markdown"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void uploadFile(file);
                    event.target.value = "";
                  }}
                  disabled={uploading}
                />
                <div
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={handleDrop}
                  className={`mt-5 flex min-h-28 flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] border border-dashed px-4 py-5 text-center transition-colors duration-normal ${
                    dragging ? "border-accent bg-accent-soft" : "border-line-strong bg-canvas"
                  }`}
                >
                  <p className="text-sm text-muted">Drop a document here, or choose a file.</p>
                  <Button
                    variant="secondary"
                    size="sm"
                    leadingIcon={<Upload size={14} />}
                    disabled={uploading}
                    loading={uploading}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {uploading ? "Uploading…" : "Choose file"}
                  </Button>
                </div>
                <p className="mt-3 text-xs leading-5 text-faint">
                  Originals are kept in private storage so documents can be re-indexed, and are deleted with the document.
                </p>
              </div>
            </Card>

            <Card>
              <div className="p-5 sm:p-6">
                <CardHeader
                  icon={<Database size={16} />}
                  title="Indexed documents"
                  description={`${readyCount} of ${documents.length} document${documents.length === 1 ? "" : "s"} available for retrieval.`}
                />
                {loading && documents.length === 0 ? (
                  <div className="mt-5 space-y-3" role="status" aria-label="Loading documents">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-4/5" />
                  </div>
                ) : documents.length === 0 ? (
                  <div className="mt-5 rounded-[var(--radius-card)] border border-line bg-canvas px-4 py-8 text-center">
                    <FileText size={20} className="mx-auto text-faint" />
                    <p className="mt-3 text-sm font-medium">No documents yet</p>
                    <p className="mt-1 text-sm text-muted">Upload a file to make its contents searchable.</p>
                  </div>
                ) : (
                  <div className="mt-5 overflow-x-auto">
                    <table className="w-full min-w-[620px] text-left text-sm">
                      <thead className="border-b border-line text-xs font-medium text-muted">
                        <tr>
                          <th className="px-3 py-2">Name</th>
                          <th className="px-3 py-2">Type</th>
                          <th className="px-3 py-2">Chunks</th>
                          <th className="px-3 py-2">Added</th>
                          <th className="px-3 py-2">Status</th>
                          <th className="px-3 py-2"><span className="sr-only">Actions</span></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {documents.map((document) => (
                          <tr key={document.id}>
                            <td className="max-w-64 truncate px-3 py-3 font-medium" title={document.name}>{document.name}</td>
                            <td className="px-3 py-3 text-muted">{document.mime_type}</td>
                            <td className="px-3 py-3 tabular-nums text-muted">{document.chunk_count}</td>
                            <td className="px-3 py-3 text-muted">{formatDate(document.created_at)}</td>
                            <td className="px-3 py-3">
                              <span title={document.last_error ?? undefined}>
                                <Badge tone={STATUS_TONE[document.status]}>
                                  {STATUS_LABEL[document.status]}
                                </Badge>
                              </span>
                            </td>
                            <td className="px-3 py-3 text-right">
                              <div className="flex items-center justify-end gap-1">
                                {document.status === "failed" && document.job_id && (
                                  <Button size="sm" variant="ghost" onClick={() => void retryDocument(document)}>
                                    Retry
                                  </Button>
                                )}
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label={`Delete ${document.name}`}
                                  onClick={() => setPendingDelete(document)}
                                  className="text-muted hover:text-danger"
                                >
                                  <Trash size={15} />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </Card>
          </>
        )}
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) void deleteDocument(pendingDelete);
        }}
        title="Delete this document?"
        description={pendingDelete ? `“${pendingDelete.name}” and its indexed passages will be permanently removed.` : undefined}
        confirmLabel="Delete document"
        destructive
      />
    </main>
  );
}
