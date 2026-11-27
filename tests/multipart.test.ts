import { describe, expect, it } from "vitest";
import { readMultipartFormData } from "@/modules/shared/lib/multipart";

function createUploadRequest(contents: string) {
  const formData = new FormData();
  formData.set("file", new File([contents], "notes.txt", { type: "text/plain" }));
  return new Request("http://localhost/api/documents", {
    method: "POST",
    body: formData,
  });
}

function createOversizedRequest() {
  return new Request("http://localhost/api/documents", {
    method: "POST",
    headers: { "content-type": "multipart/form-data; boundary=test" },
    body: "a".repeat(256),
  });
}

describe("readMultipartFormData", () => {
  it("parses a valid multipart request under the configured byte limit", async () => {
    const result = await readMultipartFormData(createUploadRequest("hello"), { maxBytes: 1024 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const file = result.data.get("file");
      expect(file).toBeInstanceOf(File);
      if (file instanceof File) expect(file.name).toBe("notes.txt");
    }
  });

  it("rejects a streamed multipart body that exceeds the byte limit", async () => {
    const result = await readMultipartFormData(createOversizedRequest(), { maxBytes: 128 });

    expect(result).toMatchObject({ ok: false, status: 413 });
  });

  it("rejects malformed multipart bodies", async () => {
    const request = new Request("http://localhost/api/documents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const result = await readMultipartFormData(request, { maxBytes: 128 });

    expect(result).toMatchObject({ ok: false, status: 400 });
  });
});
