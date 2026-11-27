import { readMultipartFormData } from "@/modules/shared/lib/multipart";
import { parseFailed, parseOk, type ParseResult } from "@/modules/shared/lib/parse";
import {
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_REQUEST_BYTES,
} from "@/modules/rag/document-processing";

export const INVALID_UPLOAD_MESSAGE = "Choose a PDF, TXT, or Markdown file.";

/** Reads and validates the bounded multipart upload; returns exactly one file. */
export async function readDocumentUpload(request: Request): Promise<ParseResult<File>> {
  const formDataResult = await readMultipartFormData(request, {
    maxBytes: MAX_UPLOAD_REQUEST_BYTES,
    tooLargeMessage: "Upload request is too large.",
    invalidMessage: "Request must be a valid multipart file upload.",
  });
  if (!formDataResult.ok) {
    return parseFailed(formDataResult.error, formDataResult.status);
  }

  const files = formDataResult.data.getAll("file");
  if (files.length !== 1 || !(files[0] instanceof File)) {
    return parseFailed(INVALID_UPLOAD_MESSAGE, 400);
  }
  if (files[0].size > MAX_UPLOAD_BYTES) {
    return parseFailed("Files must be 4 MB or smaller.", 413);
  }

  return parseOk(files[0]);
}
