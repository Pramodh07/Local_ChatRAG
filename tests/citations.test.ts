import { describe, expect, it } from "vitest";
import { extractCitedSources } from "@/modules/rag/answer-question";
import type { Citation } from "@/modules/chat/types";

const dummyCitations: Citation[] = [
  { id: 1, doc: "doc1.pdf", excerpt: "Excerpt 1", score: 0.9 },
  { id: 2, doc: "doc2.pdf", excerpt: "Excerpt 2", score: 0.8 },
  { id: 3, doc: "doc3.pdf", excerpt: "Excerpt 3", score: 0.7 },
];

describe("extractCitedSources", () => {
  it("filters citations to only those referenced in markdown format", () => {
    const answer = "According to the financial report [1](#cite-1), revenue was high. Also confirmed in [3](#cite-3).";
    const result = extractCitedSources(answer, dummyCitations);
    expect(result.map((c) => c.id)).toEqual([1, 3]);
  });

  it("handles plain numeric citations [1] and ignores out-of-range IDs", () => {
    const answer = "Claim supported by [2] and an invalid reference [99].";
    const result = extractCitedSources(answer, dummyCitations);
    expect(result.map((c) => c.id)).toEqual([2]);
  });

  it("returns an empty citation array when model abstains due to lack of information", () => {
    const answer = "I couldn't find relevant information in the provided excerpts.";
    const result = extractCitedSources(answer, dummyCitations);
    expect(result).toEqual([]);
  });

  it("does not present uncited sources for a substantive answer with no markers", () => {
    const answer = "The project roadmap describes a three-phase rollout starting next quarter.";
    const result = extractCitedSources(answer, dummyCitations);
    expect(result).toEqual([]);
  });
});
