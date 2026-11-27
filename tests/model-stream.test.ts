import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceConfigurationError } from "@/modules/shared/lib/errors";

const mocks = vi.hoisted(() => ({ getOpenAI: vi.fn() }));

vi.mock("@/modules/shared/integrations/openai", () => ({ getOpenAI: mocks.getOpenAI }));

import {
  estimateStreamTokens,
  streamLocalModelAnswer,
  type StreamStats,
} from "@/modules/account/model-stream";

const signal = new AbortController().signal;

function sseResponse(text: string): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(text));
        controller.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}

async function collect(stream: AsyncGenerator<string>): Promise<string[]> {
  const texts: string[] = [];
  for await (const text of stream) texts.push(text);
  return texts;
}

const savedEnv = { ...process.env };

beforeEach(() => {
  mocks.getOpenAI.mockReset();
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const name of [
    "ANTHROPIC_API_KEY",
    "GOOGLE_API_KEY",
    "GEMINI_API_KEY",
    "OLLAMA_BASE_URL",
  ] as const) {
    const value = savedEnv[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("estimateStreamTokens", () => {
  it("returns 0 for empty text and a positive estimate otherwise", () => {
    expect(estimateStreamTokens("")).toBe(0);
    expect(estimateStreamTokens("abcd")).toBe(1);
    expect(estimateStreamTokens("abcde")).toBe(2);
  });
});

describe("streamLocalModelAnswer", () => {
  it("streams OpenAI chat completion deltas and reports usage", async () => {
    const chunks = [
      { choices: [{ delta: { content: "Hi" } }] },
      { choices: [{ delta: { content: "!" } }] },
      { choices: [], usage: { prompt_tokens: 3, completion_tokens: 2 } },
    ];
    mocks.getOpenAI.mockReturnValue({
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            async *[Symbol.asyncIterator]() {
              for (const chunk of chunks) yield chunk;
            },
          }),
        },
      },
    });
    const stats: StreamStats = { inputTokens: 0, outputTokens: 0 };

    const texts = await collect(
      streamLocalModelAnswer({
        provider: "openai",
        model: "gpt-6.2-sol",
        message: "hello",
        history: [],
        signal,
        stats,
      }),
    );

    expect(texts).toEqual(["Hi", "!"]);
    expect(stats).toEqual({ inputTokens: 3, outputTokens: 2 });
    expect(mocks.getOpenAI).toHaveBeenCalledWith();
  });

  it("parses Anthropic SSE events with server env keys only", async () => {
    process.env.ANTHROPIC_API_KEY = "anthropic-key";
    const fetchMock = vi.mocked(fetch);
    vi.mocked(fetchMock).mockResolvedValue(
      sseResponse(
        [
          "event: message_start",
          'data: {"type":"message_start","message":{"usage":{"input_tokens":7}}}',
          "",
          "event: content_block_delta",
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello "}}',
          "",
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"world"}}',
          "",
          'data: {"type":"message_delta","usage":{"output_tokens":5}}',
          "",
          'data: {"type":"message_stop"}',
          "",
        ].join("\n"),
      ),
    );
    const stats: StreamStats = { inputTokens: 0, outputTokens: 0 };

    const texts = await collect(
      streamLocalModelAnswer({
        provider: "anthropic",
        model: "claude-sonnet-5-5",
        message: "hello",
        history: [],
        signal,
        stats,
      }),
    );

    expect(texts).toEqual(["Hello ", "world"]);
    expect(stats).toEqual({ inputTokens: 7, outputTokens: 5 });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-api-key": "anthropic-key" }),
      }),
    );
  });

  it("parses Gemini SSE events with a custom system prompt", async () => {
    process.env.GEMINI_API_KEY = "google-key";
    const fetchMock = vi.mocked(fetch);
    vi.mocked(fetchMock).mockResolvedValue(
      sseResponse(
        [
          'data: {"candidates":[{"content":{"parts":[{"text":"Sure"}]}}],"usageMetadata":{"promptTokenCount":4,"candidatesTokenCount":1}}',
          "",
        ].join("\n"),
      ),
    );
    const stats: StreamStats = { inputTokens: 0, outputTokens: 0 };

    const texts = await collect(
      streamLocalModelAnswer({
        provider: "google",
        model: "gemini-4-argon",
        message: "hello",
        history: [],
        signal,
        systemPrompt: "RAG system prompt",
        stats,
      }),
    );

    expect(texts).toEqual(["Sure"]);
    expect(stats).toEqual({ inputTokens: 4, outputTokens: 1 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(":streamGenerateContent?alt=sse");
    expect(JSON.parse(String(init.body))).toMatchObject({
      systemInstruction: { parts: [{ text: "RAG system prompt" }] },
    });
  });

  it("parses Ollama NDJSON without requiring an API key", async () => {
    process.env.OLLAMA_BASE_URL = "http://localhost:11434/";
    const fetchMock = vi.mocked(fetch);
    const encoder = new TextEncoder();
    const lines = [
      '{"message":{"content":"Hi"},"done":false}',
      '{"message":{"content":" there"},"done":false}',
      '{"message":{"content":""},"done":true,"prompt_eval_count":4,"eval_count":6}',
    ].join("\n");
    vi.mocked(fetchMock).mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(lines));
            controller.close();
          },
        }),
        { status: 200 },
      ),
    );
    const stats: StreamStats = { inputTokens: 0, outputTokens: 0 };

    const texts = await collect(
      streamLocalModelAnswer({
        provider: "ollama",
        model: "llama-local",
        message: "hello",
        history: [],
        signal,
        stats,
      }),
    );

    expect(texts).toEqual(["Hi", " there"]);
    expect(stats).toEqual({ inputTokens: 4, outputTokens: 6 });
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:11434/api/chat");
  });

  it("rejects when a provider key is not configured on the server", async () => {
    delete process.env.ANTHROPIC_API_KEY;

    await expect(
      collect(
        streamLocalModelAnswer({
          provider: "anthropic",
          model: "claude-sonnet-5-5",
          message: "hello",
          history: [],
          signal,
        }),
      ),
    ).rejects.toBeInstanceOf(ServiceConfigurationError);
    expect(fetch).not.toHaveBeenCalled();
  });
});
