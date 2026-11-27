export type MultipartFormDataResult =
  | { ok: true; data: FormData }
  | { ok: false; error: string; status: 400 | 413 };

export async function readMultipartFormData(
  request: Request,
  {
    maxBytes,
    tooLargeMessage = "Upload request is too large.",
    invalidMessage = "Request must be a valid multipart file upload.",
  }: {
    maxBytes: number;
    tooLargeMessage?: string;
    invalidMessage?: string;
  },
): Promise<MultipartFormDataResult> {
  const contentType = request.headers.get("content-type");
  if (!contentType || !/^multipart\/form-data\s*;/i.test(contentType)) {
    return { ok: false, error: invalidMessage, status: 400 };
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    return { ok: false, error: tooLargeMessage, status: 413 };
  }

  const reader = request.body?.getReader();
  if (!reader) return { ok: false, error: invalidMessage, status: 400 };

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        try {
          await reader.cancel();
        } catch (error) {
          console.error("Cancelling an oversized upload request failed:", error);
        }
        return { ok: false, error: tooLargeMessage, status: 413 };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, error: invalidMessage, status: 400 };
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const boundedRequest = new Request(request.url, {
      method: request.method,
      headers: { "content-type": contentType },
      body,
    });
    return { ok: true, data: await boundedRequest.formData() };
  } catch {
    return { ok: false, error: invalidMessage, status: 400 };
  }
}
