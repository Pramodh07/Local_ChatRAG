import { isRecord } from "@/modules/shared/lib/guards";
import { parseFailed, parseOk, type ParseResult } from "@/modules/shared/lib/parse";
import { readMultipartFormData } from "@/modules/shared/lib/multipart";
import { readJsonBody } from "@/modules/shared/lib/request";

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_BASE64_LENGTH = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 500;
const ALLOWED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export function isValidAvatarUrl(url: string): boolean {
  if (url.length > MAX_BASE64_LENGTH) return false;
  if (url.startsWith("data:image/")) {
    return /^data:(image\/(png|jpeg|webp|gif));base64,/.test(url);
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Accepts either a multipart image upload or a JSON `{ avatarUrl }` payload.
 * `null` means "clear the avatar".
 */
export async function parseAvatarRequest(request: Request): Promise<ParseResult<string | null>> {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    const multipart = await readMultipartFormData(request, {
      maxBytes: MAX_IMAGE_BYTES + 64 * 1024,
      tooLargeMessage: "Image file is too large. Maximum size is 2MB.",
      invalidMessage: "Request must be a valid multipart file upload.",
    });
    if (!multipart.ok) {
      return parseFailed(multipart.error, multipart.status);
    }
    const file = multipart.data.get("file");
    if (!(file instanceof File)) return parseFailed("No image file provided.", 400);
    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      return parseFailed("Unsupported image format. Use PNG, JPG, WebP, or GIF.", 400);
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return parseFailed("Image file is too large. Maximum size is 2MB.", 413);
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    return parseOk(`data:${file.type};base64,${buffer.toString("base64")}`);
  }

  const jsonResult = await readJsonBody(request, {
    maxBytes: MAX_BASE64_LENGTH + 4096,
    invalidMessage: "Invalid JSON body.",
    tooLargeMessage: "Image file is too large. Maximum size is 2MB.",
  });
  if (!jsonResult.ok) {
    return parseFailed(jsonResult.error, jsonResult.status);
  }
  const payload = jsonResult.data;
  if (!isRecord(payload)) return parseFailed("Invalid request payload.", 400);
  if (payload.avatarUrl === null || payload.avatarUrl === "") return parseOk(null);
  if (typeof payload.avatarUrl !== "string") {
    return parseFailed("Invalid avatarUrl field.", 400);
  }
  if (!isValidAvatarUrl(payload.avatarUrl)) {
    return parseFailed("Invalid image format or image size exceeds 2MB.", 400);
  }
  return parseOk(payload.avatarUrl);
}
