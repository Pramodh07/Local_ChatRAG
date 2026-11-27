import "server-only";

import { DEFAULT_DOCUMENT_CHUNK_SIZE } from "@/modules/chat/runtime-settings";

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_UPLOAD_REQUEST_BYTES = MAX_UPLOAD_BYTES + 64 * 1024;
const MAX_EXTRACTED_CHARACTERS = 250_000;
const MAX_PDF_PAGES = 200;
const CHUNK_OVERLAP = 160;
const SUPPORTED_TEXT_EXTENSIONS = new Set(["txt", "md", "markdown"]);

export type TextChunk = {
  content: string;
  page: number | null;
};

export type ExtractedDocument = {
  pages: string[];
  mimeType: string;
};

export function uploadExtension(name: string): string {
  return name.toLowerCase().split(".").pop() ?? "";
}

export function isSupportedUpload(name: string, mimeType: string): boolean {
  const extension = uploadExtension(name);
  return (
    mimeType === "application/pdf" ||
    extension === "pdf" ||
    SUPPORTED_TEXT_EXTENSIONS.has(extension)
  );
}

export function normalizeUploadMimeType(name: string, mimeType: string): string {
  if (mimeType === "application/pdf" || uploadExtension(name) === "pdf") {
    return "application/pdf";
  }
  if (uploadExtension(name) === "md" || uploadExtension(name) === "markdown") {
    return "text/markdown";
  }
  return "text/plain";
}

export function validateUpload(name: string, mimeType: string, size: number): void {
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new Error("The selected file is empty.");
  }
  if (size > MAX_UPLOAD_BYTES) {
    throw new Error("Files must be 4 MB or smaller.");
  }
  if (!isSupportedUpload(name, mimeType)) {
    throw new Error("Upload a PDF, TXT, or Markdown file.");
  }
}

export async function extractDocumentPagesFromBytes(input: {
  bytes: Uint8Array;
  name: string;
  mimeType: string;
}): Promise<ExtractedDocument> {
  const { bytes, name, mimeType } = input;
  validateUpload(name, mimeType, bytes.byteLength);

  const extension = uploadExtension(name);
  if (mimeType === "application/pdf" || extension === "pdf") {
    // Extension/MIME alone are user-controlled. Reject bytes that are clearly
    // not a PDF before handing them to the parser.
    const signature = new TextDecoder("latin1").decode(bytes.slice(0, 5));
    if (signature !== "%PDF-") {
      throw new Error("The file does not appear to be a valid PDF.");
    }
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(bytes);
    if (pdf.numPages > MAX_PDF_PAGES) {
      throw new Error(`PDFs must contain ${MAX_PDF_PAGES} pages or fewer.`);
    }

    const { text } = await extractText(pdf);
    const pages = Array.isArray(text) ? text : [text];
    if (!pages.join("\n").trim()) {
      throw new Error("No selectable text was found. Scanned PDFs need OCR before upload.");
    }
    return { pages, mimeType: "application/pdf" };
  }

  if (SUPPORTED_TEXT_EXTENSIONS.has(extension)) {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    if (!text.trim()) {
      throw new Error("The selected file contains no text.");
    }
    return { pages: [text], mimeType: normalizeUploadMimeType(name, mimeType) };
  }

  throw new Error("Upload a PDF, TXT, or Markdown file.");
}

export async function extractDocumentPages(file: File): Promise<string[]> {
  if (file.size === 0) {
    throw new Error("The selected file is empty.");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error("Files must be 4 MB or smaller.");
  }

  const extracted = await extractDocumentPagesFromBytes({
    bytes: new Uint8Array(await file.arrayBuffer()),
    name: file.name,
    mimeType: file.type || normalizeUploadMimeType(file.name, ""),
  });
  return extracted.pages;
}

export function chunkPages(
  pages: string[],
  includePageNumbers = false,
  chunkSize = DEFAULT_DOCUMENT_CHUNK_SIZE,
): TextChunk[] {
  const normalizedPages = pages.map((page) =>
    page.replace(/\0/g, "").replace(/\r\n?/g, "\n").trim(),
  );
  const totalCharacters = normalizedPages.reduce((total, page) => total + page.length, 0);
  if (totalCharacters > MAX_EXTRACTED_CHARACTERS) {
    throw new Error("Extracted documents must be 250,000 characters or fewer.");
  }

  const chunks: TextChunk[] = [];
  normalizedPages.forEach((pageText, pageIndex) => {
    let start = 0;
    while (start < pageText.length) {
      let end = Math.min(start + chunkSize, pageText.length);
      if (end < pageText.length) {
        const paragraphBoundary = pageText.lastIndexOf("\n", end);
        const wordBoundary = pageText.lastIndexOf(" ", end);
        const boundary = Math.max(paragraphBoundary, wordBoundary);
        if (boundary > start + chunkSize / 2) end = boundary;
      }

      const content = pageText.slice(start, end).trim();
      if (content) chunks.push({ content, page: includePageNumbers ? pageIndex + 1 : null });
      if (end >= pageText.length) break;
      start = Math.max(end - CHUNK_OVERLAP, start + 1);
    }
  });

  if (chunks.length === 0) {
    throw new Error("No text could be extracted from the selected file.");
  }
  return chunks;
}
