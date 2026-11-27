import "server-only";

type ReadJsonBodyOptions = {
  maxBytes: number;
  tooLargeMessage?: string;
  invalidMessage?: string;
};

export type JsonBodyResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string; status: 400 | 413 };

export async function readJsonBody(
  request: Request,
  {
    maxBytes,
    tooLargeMessage = "Request body is too large.",
    invalidMessage = "Request body must be valid JSON.",
  }: ReadJsonBodyOptions,
): Promise<JsonBodyResult> {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    return { ok: false, error: tooLargeMessage, status: 413 };
  }

  const reader = request.body?.getReader();
  if (!reader) {
    try {
      const text = await request.text();
      if (!text) return { ok: false, error: invalidMessage, status: 400 };
      if (Buffer.byteLength(text, "utf8") > maxBytes) {
        return { ok: false, error: tooLargeMessage, status: 413 };
      }
      return { ok: true, data: JSON.parse(text) };
    } catch {
      return { ok: false, error: invalidMessage, status: 400 };
    }
  }

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
        } catch {
          // ignore
        }
        return { ok: false, error: tooLargeMessage, status: 413 };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, error: invalidMessage, status: 400 };
  }

  const fullBytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    fullBytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const text = new TextDecoder("utf-8").decode(fullBytes);
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: false, error: invalidMessage, status: 400 };
  }
}
