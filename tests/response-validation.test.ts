import { describe, expect, it } from "vitest";
import { isChatResponse, isCitation, isUploadJobResponse } from "@/modules/chat/response-validation";

const validUpload = {
  documentId: "doc-1",
  jobId: "job-1",
  name: "notes.txt",
  status: "queued",
  duplicate: false,
};

const validCitation = {
  id: 1,
  doc: "annual-report.pdf",
  page: 12,
  section: "Financial Highlights",
  excerpt: "Revenue increased by 15% year-over-year.",
  score: 0.89,
};

describe("chat API response validation", () => {
  it("accepts valid chat and upload responses", () => {
    expect(isChatResponse({ answer: "Answer", citations: [], tokens: 10 })).toBe(true);
    expect(isChatResponse({ answer: "Answer", citations: [validCitation], tokens: 10 })).toBe(true);
    expect(isUploadJobResponse(validUpload)).toBe(true);
  });

  it("validates citation integrity", () => {
    expect(isCitation(validCitation)).toBe(true);
    expect(isCitation({ ...validCitation, page: undefined, section: undefined })).toBe(true);
    expect(isCitation({ ...validCitation, id: 0 })).toBe(false);
    expect(isCitation({ ...validCitation, id: -1 })).toBe(false);
    expect(isCitation({ ...validCitation, doc: "  " })).toBe(false);
    expect(isCitation({ ...validCitation, score: Number.NaN })).toBe(false);
    expect(isCitation({ ...validCitation, page: -5 })).toBe(false);
    expect(isCitation({ ...validCitation, section: 42 })).toBe(false);
    expect(isCitation("not-a-citation")).toBe(false);
  });

  it("rejects malformed API responses", () => {
    expect(isChatResponse({ answer: "Answer", citations: "none", tokens: 10 })).toBe(false);
    expect(
      isChatResponse({
        answer: "Answer",
        citations: [{ invalid: "citation" }],
        tokens: 10,
      }),
    ).toBe(false);
    expect(isChatResponse({ answer: "Answer", citations: [], tokens: -1 })).toBe(false);
    expect(isUploadJobResponse({ ...validUpload, status: "indexing" })).toBe(false);
    expect(isUploadJobResponse({ ...validUpload, duplicate: "no" })).toBe(false);
  });
});
