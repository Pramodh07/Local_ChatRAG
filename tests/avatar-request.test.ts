import { describe, expect, it } from "vitest";
import { isValidAvatarUrl, parseAvatarRequest } from "@/modules/account/avatar-request";

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/account/avatar", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("avatar request parsing", () => {
  it("accepts an HTTPS URL and a PNG data URL", async () => {
    await expect(parseAvatarRequest(jsonRequest({ avatarUrl: "https://example.com/a.png" }))).resolves.toEqual({
      ok: true,
      value: "https://example.com/a.png",
    });
    const dataUrl = "data:image/png;base64,abc";
    await expect(parseAvatarRequest(jsonRequest({ avatarUrl: dataUrl }))).resolves.toEqual({
      ok: true,
      value: dataUrl,
    });
  });

  it("treats null and an empty string as clearing the avatar", async () => {
    await expect(parseAvatarRequest(jsonRequest({ avatarUrl: null }))).resolves.toEqual({
      ok: true,
      value: null,
    });
    await expect(parseAvatarRequest(jsonRequest({ avatarUrl: "" }))).resolves.toEqual({
      ok: true,
      value: null,
    });
  });

  it("rejects unsupported schemes and malformed fields", async () => {
    await expect(parseAvatarRequest(jsonRequest({ avatarUrl: "ftp://example.com/a.png" }))).resolves.toEqual({
      ok: false,
      status: 400,
      message: "Invalid image format or image size exceeds 2MB.",
    });
    await expect(parseAvatarRequest(jsonRequest({ avatarUrl: "data:image/svg+xml;base64,abc" }))).resolves.toEqual({
      ok: false,
      status: 400,
      message: "Invalid image format or image size exceeds 2MB.",
    });
    await expect(parseAvatarRequest(jsonRequest({ avatarUrl: 42 }))).resolves.toEqual({
      ok: false,
      status: 400,
      message: "Invalid avatarUrl field.",
    });
  });

  it("rejects invalid JSON and non-object payloads", async () => {
    await expect(
      parseAvatarRequest(
        new Request("http://localhost/api/account/avatar", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "not-json",
        }),
      ),
    ).resolves.toEqual({ ok: false, status: 400, message: "Invalid JSON body." });

    await expect(parseAvatarRequest(jsonRequest(null))).resolves.toEqual({
      ok: false,
      status: 400,
      message: "Invalid request payload.",
    });
  });

  it("accepts a valid multipart image and rejects unsupported MIME types", async () => {
    const formData = new FormData();
    formData.append("file", new File([new Uint8Array([1, 2, 3])], "avatar.png", { type: "image/png" }));
    const result = await parseAvatarRequest(
      new Request("http://localhost/api/account/avatar", { method: "POST", body: formData }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toMatch(/^data:image\/png;base64,/);

    const invalid = new FormData();
    invalid.append("file", new File(["text"], "avatar.txt", { type: "text/plain" }));
    await expect(
      parseAvatarRequest(new Request("http://localhost/api/account/avatar", { method: "POST", body: invalid })),
    ).resolves.toEqual({
      ok: false,
      status: 400,
      message: "Unsupported image format. Use PNG, JPG, WebP, or GIF.",
    });

    const oversized = new Request("http://localhost/api/account/avatar", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "4000000" },
      body: JSON.stringify({ avatarUrl: "https://example.com/large.png" }),
    });
    await expect(parseAvatarRequest(oversized)).resolves.toEqual({
      ok: false,
      status: 413,
      message: "Image file is too large. Maximum size is 2MB.",
    });
  });
});

describe("isValidAvatarUrl", () => {
  it("accepts HTTP(S) and supported data URLs", () => {
    expect(isValidAvatarUrl("http://example.com/a.png")).toBe(true);
    expect(isValidAvatarUrl("https://example.com/a.png")).toBe(true);
    expect(isValidAvatarUrl("data:image/jpeg;base64,abc")).toBe(true);
  });

  it("rejects unsupported or malformed values", () => {
    expect(isValidAvatarUrl("data:image/svg+xml;base64,abc")).toBe(false);
    expect(isValidAvatarUrl("not a url")).toBe(false);
    expect(isValidAvatarUrl("javascript:alert(1)")).toBe(false);
  });
});
