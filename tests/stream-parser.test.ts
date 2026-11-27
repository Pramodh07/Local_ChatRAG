import { describe, expect, it } from "vitest";
import { createLineParser } from "@/modules/chat/stream-parser";

describe("createLineParser", () => {
  it("parses complete lines and buffers partial ones across chunks", () => {
    const seen: string[] = [];
    const parse = createLineParser((line) => seen.push(line));

    parse('{"type":"delta","text":"he');
    expect(seen).toEqual([]);
    parse('llo"}\n{"type":"result","answer":"hello"}\n');
    expect(seen).toEqual([
      '{"type":"delta","text":"hello"}',
      '{"type":"result","answer":"hello"}',
    ]);
  });

  it("ignores blank lines", () => {
    const seen: string[] = [];
    const parse = createLineParser((line) => seen.push(line));
    parse("\n\n{\"a\":1}\n");
    expect(seen).toEqual(['{"a":1}']);
  });
});
