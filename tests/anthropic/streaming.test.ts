import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type Anthropic from "@anthropic-ai/sdk";
import { headers, startTestServer, stopTestServer, type TestContext } from "./setup";

const MODEL = "claude-opus-5";

const WEATHER: Anthropic.Tool = {
  name: "get_weather",
  input_schema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
};

describe("anthropic streaming", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestServer();
  });
  afterAll(() => stopTestServer(ctx));

  const rawStream = (body: unknown) =>
    fetch(`${ctx.baseURL}/v1/messages`, {
      method: "POST",
      headers: { ...headers(), "content-type": "application/json" },
      body: JSON.stringify({ ...(body as object), stream: true }),
    });

  const frames = async (body: unknown): Promise<string[]> =>
    (await rawStream(body).then((r) => r.text())).split("\n\n").filter(Boolean);

  it("streams text that reassembles into the whole reply", async () => {
    const stream = ctx.client.messages.stream({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: "user", content: "a prompt long enough to arrive in pieces" }],
    });

    let text = "";
    let deltas = 0;
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        text += event.delta.text;
        deltas += 1;
      }
    }

    expect(text).toBe("Echo: a prompt long enough to arrive in pieces");
    expect(deltas).toBeGreaterThan(1);
  });

  it("names every SSE event, which the SDK requires to read anything", async () => {
    const sent = await frames({ model: MODEL, max_tokens: 16, messages: [{ role: "user", content: "hi" }] });

    // Without the `event:` line the SDK sees zero chunks — verified against
    // the real client. This is the hard divergence from OpenAI and Gemini,
    // which both send `data:` alone.
    expect(sent.every((frame) => frame.startsWith("event: "))).toBe(true);
    expect(sent.map((frame) => frame.split("\n")[0]?.replace("event: ", ""))).toEqual([
      "message_start",
      "content_block_start",
      "content_block_delta",
      "content_block_stop",
      "message_delta",
      "message_stop",
    ]);
  });

  it("terminates with message_stop and no sentinel string", async () => {
    const res = await rawStream({ model: MODEL, max_tokens: 16, messages: [{ role: "user", content: "hi" }] });
    const raw = await res.text();

    expect(res.headers.get("content-type")).toContain("text/event-stream");
    // OpenAI's `[DONE]` would be wrong here; the SDK parses every frame as JSON.
    expect(raw).not.toContain("[DONE]");
    expect(raw.trimEnd().endsWith('data: {"type":"message_stop"}')).toBe(true);
  });

  it("opens with a message carrying no content and no verdict", async () => {
    const [first] = await frames({ model: MODEL, max_tokens: 16, messages: [{ role: "user", content: "hi" }] });
    const data = JSON.parse(first!.split("\n")[1]!.replace("data: ", "")) as {
      message: { content: unknown[]; stop_reason: null; usage: { output_tokens: number } };
    };

    expect(data.message.content).toEqual([]);
    expect(data.message.stop_reason).toBeNull();
    expect(data.message.usage.output_tokens).toBe(0);
  });

  it("reports the verdict and output tokens on message_delta", async () => {
    const sent = await frames({ model: MODEL, max_tokens: 16, messages: [{ role: "user", content: "hi" }] });
    const frame = sent.find((f) => f.startsWith("event: message_delta"))!;
    const data = JSON.parse(frame.split("\n")[1]!.replace("data: ", "")) as {
      delta: { stop_reason: string; stop_sequence: null };
      usage: { output_tokens: number };
    };

    expect(data.delta.stop_reason).toBe("end_turn");
    expect(data.delta.stop_sequence).toBeNull();
    expect(data.usage.output_tokens).toBeGreaterThan(0);
  });

  it("streams a tool call's arguments as input_json_delta pieces", async () => {
    const stream = ctx.client.messages.stream({
      model: MODEL,
      max_tokens: 1024,
      tools: [WEATHER],
      tool_choice: { type: "any" },
      messages: [{ role: "user", content: "weather?" }],
    });

    let encoded = "";
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "input_json_delta") {
        encoded += event.delta.partial_json;
      }
    }
    const final = await stream.finalMessage();

    // The one place this API re-encodes what it otherwise sends decoded.
    expect(JSON.parse(encoded)).toEqual({ city: "mock" });
    expect(final.stop_reason).toBe("tool_use");
    expect(final.content[0]).toMatchObject({ type: "tool_use", input: { city: "mock" } });
  });

  it("streams thinking, then its signature as a separate delta", async () => {
    const sent = await frames({
      model: MODEL,
      max_tokens: 4096,
      thinking: { type: "adaptive", display: "summarized" },
      messages: [{ role: "user", content: "think hard" }],
    });
    const deltas = sent
      .filter((frame) => frame.startsWith("event: content_block_delta"))
      .map((frame) => JSON.parse(frame.split("\n")[1]!.replace("data: ", "")) as { delta: { type: string } })
      .map((event) => event.delta.type);

    expect(deltas).toContain("thinking_delta");
    // The signature arrives under its own delta type, after the reasoning.
    expect(deltas).toContain("signature_delta");
    expect(deltas.indexOf("signature_delta")).toBeGreaterThan(deltas.indexOf("thinking_delta"));
  });

  it("assembles the same message the non-streaming call returns", async () => {
    const payload = {
      model: MODEL,
      max_tokens: 16,
      messages: [{ role: "user" as const, content: "consistency" }],
    };

    const direct = (await fetch(`${ctx.baseURL}/v1/messages`, {
      method: "POST",
      headers: { ...headers(), "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then((r) => r.json())) as Record<string, unknown>;

    const stream = ctx.client.messages.stream(payload);
    for await (const _ of stream) {
      /* drain */
    }
    const assembled = (await stream.finalMessage()) as unknown as Record<string, unknown>;

    // `parsed_output` is added client-side by the SDK's accumulator, so it is
    // not part of what the server sent.
    for (const field of ["id", "type", "role", "model", "content", "stop_reason", "stop_sequence", "usage"]) {
      expect(assembled[field]).toEqual(direct[field]);
    }
  });

  it("works through the SDK's text helper", async () => {
    const stream = ctx.client.messages.stream({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: "user", content: "helper path" }],
    });

    let text = "";
    stream.on("text", (delta) => {
      text += delta;
    });
    await stream.finalMessage();

    expect(text).toBe("Echo: helper path");
  });
});
