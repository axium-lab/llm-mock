import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import Anthropic from "@anthropic-ai/sdk";
import { headers, startTestServer, stopTestServer, type TestContext } from "./setup";

const MODEL = "claude-opus-5";

const WEATHER: Anthropic.Tool = {
  name: "get_weather",
  description: "Get the weather for a city",
  input_schema: {
    type: "object",
    properties: { city: { type: "string" }, unit: { type: "string", enum: ["celsius", "fahrenheit"] } },
    required: ["city", "unit"],
  },
};

describe("anthropic messages", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestServer();
  });
  afterAll(() => stopTestServer(ctx));

  const post = (body: unknown, extra: Record<string, string> = {}) =>
    fetch(`${ctx.baseURL}/v1/messages`, {
      method: "POST",
      headers: { ...headers(), "content-type": "application/json", ...extra },
      body: JSON.stringify(body),
    });

  it("answers with a message object of content blocks", async () => {
    const message = await ctx.client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: "user", content: "Hello!" }],
    });

    expect(message.type).toBe("message");
    expect(message.role).toBe("assistant");
    expect(message.model).toBe(MODEL);
    expect(message.stop_reason).toBe("end_turn");
    expect(message.stop_sequence).toBeNull();
    expect(message.content).toEqual([{ type: "text", text: "Echo: Hello!", citations: null }]);
  });

  it("mints ids with this API's own prefix", async () => {
    const message = await ctx.client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(message.id).toStartWith("msg_");
  });

  it("reports usage as input/output tokens", async () => {
    const message = await ctx.client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(message.usage.input_tokens).toBeGreaterThan(0);
    expect(message.usage.output_tokens).toBeGreaterThan(0);
  });

  it("echoes the last user turn of a multi-turn conversation", async () => {
    const message = await ctx.client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      messages: [
        { role: "user", content: "first" },
        { role: "assistant", content: "ack" },
        { role: "user", content: "second" },
      ],
    });

    expect(message.content[0]).toEqual({ type: "text", text: "Echo: second", citations: null });
  });

  it("counts the top-level system prompt towards the input tokens", async () => {
    const [plain, withSystem] = await Promise.all([
      ctx.client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        messages: [{ role: "user", content: "hi" }],
      }),
      ctx.client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        // A top-level field, not a message with role "system".
        system: "You are a very terse assistant.",
        messages: [{ role: "user", content: "hi" }],
      }),
    ]);

    expect(withSystem.usage.input_tokens).toBeGreaterThan(plain.usage.input_tokens);
  });

  it("reads content given as blocks, not just as a string", async () => {
    const message = await ctx.client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: "user", content: [{ type: "text", text: "block form" }] }],
    });

    expect(message.content[0]).toEqual({ type: "text", text: "Echo: block form", citations: null });
  });

  it("pins the reply with the x-llm-mock-response header", async () => {
    const res = await post(
      { model: MODEL, max_tokens: 16, messages: [{ role: "user", content: "hi" }] },
      { "x-llm-mock-response": "pinned!" },
    );
    const body = (await res.json()) as { content: { text: string }[] };

    expect(body.content[0]?.text).toBe("pinned!");
  });

  it("returns byte-identical responses for identical requests", async () => {
    const payload = { model: MODEL, max_tokens: 16, messages: [{ role: "user", content: "same" }] };
    const [first, second] = await Promise.all([
      post(payload).then((r) => r.text()),
      post(payload).then((r) => r.text()),
    ]);

    expect(first).toBe(second);
  });

  describe("thinking", () => {
    it("emits a thinking block with a summary when asked for one", async () => {
      const message = await ctx.client.messages.create({
        model: MODEL,
        max_tokens: 4096,
        thinking: { type: "adaptive", display: "summarized" },
        messages: [{ role: "user", content: "think about this" }],
      });
      const block = message.content[0];

      expect(block?.type).toBe("thinking");
      expect(block && "thinking" in block ? block.thinking : "").toContain("think about this");
      expect(block && "signature" in block ? block.signature : "").toBeTruthy();
    });

    it("emits the block with empty text under the default display", async () => {
      const message = await ctx.client.messages.create({
        model: MODEL,
        max_tokens: 4096,
        thinking: { type: "adaptive" },
        messages: [{ role: "user", content: "think" }],
      });
      const block = message.content[0];

      // "omitted" is the default on the current generation: the block is still
      // there, its text is not.
      expect(block?.type).toBe("thinking");
      expect(block && "thinking" in block ? block.thinking : "x").toBe("");
    });

    it("emits no thinking block when thinking is not requested", async () => {
      const message = await ctx.client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        messages: [{ role: "user", content: "hi" }],
      });

      expect(message.content.every((block) => block.type !== "thinking")).toBe(true);
    });
  });

  describe("tool use", () => {
    it("forces a tool_use block when tool_choice is any", async () => {
      const message = await ctx.client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        tools: [WEATHER],
        tool_choice: { type: "any" },
        messages: [{ role: "user", content: "weather?" }],
      });
      const block = message.content[0];

      expect(message.stop_reason).toBe("tool_use");
      expect(block?.type).toBe("tool_use");
      expect(block && "id" in block ? block.id : "").toStartWith("toolu_");
      // Decoded here, unlike OpenAI's JSON string.
      expect(block && "input" in block ? block.input : null).toEqual({ city: "mock", unit: "celsius" });
    });

    it("names a specific tool when tool_choice does", async () => {
      const search: Anthropic.Tool = {
        name: "search",
        input_schema: { type: "object", properties: {} },
      };
      const message = await ctx.client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        tools: [WEATHER, search],
        tool_choice: { type: "tool", name: "search" },
        messages: [{ role: "user", content: "anything" }],
      });

      expect(message.content[0]).toMatchObject({ type: "tool_use", name: "search" });
    });

    it("answers with prose under the default tool_choice, having no model", async () => {
      const message = await ctx.client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        tools: [WEATHER],
        messages: [{ role: "user", content: "weather?" }],
      });

      expect(message.stop_reason).toBe("end_turn");
      expect(message.content[0]?.type).toBe("text");
    });

    it("never calls a tool when tool_choice is none", async () => {
      const message = await ctx.client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        tools: [WEATHER],
        tool_choice: { type: "none" },
        messages: [{ role: "user", content: "weather?" }],
      });

      expect(message.stop_reason).toBe("end_turn");
    });

    it("terminates the loop once a tool_result is in the conversation", async () => {
      const message = await ctx.client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        tools: [WEATHER],
        tool_choice: { type: "any" },
        messages: [
          { role: "user", content: "weather?" },
          {
            role: "assistant",
            content: [{ type: "tool_use", id: "toolu_1", name: "get_weather", input: { city: "Valencia" } }],
          },
          // The result comes back inside a *user* message on this API.
          { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "30C" }] },
        ],
      });

      expect(message.stop_reason).toBe("end_turn");
      expect(message.content[0]).toEqual({ type: "text", text: "Echo: weather?", citations: null });
    });

    it("pins exact calls with the x-llm-mock-tool-calls header", async () => {
      const res = await post(
        { model: MODEL, max_tokens: 16, tools: [WEATHER], messages: [{ role: "user", content: "weather?" }] },
        { "x-llm-mock-tool-calls": JSON.stringify([{ name: "get_weather", arguments: { city: "Valencia" } }]) },
      );
      const body = (await res.json()) as { content: { type: string; name?: string; input?: unknown }[] };

      expect(body.content[0]).toMatchObject({
        type: "tool_use",
        name: "get_weather",
        input: { city: "Valencia" },
      });
    });
  });

  describe("validation", () => {
    it("requires max_tokens, which no other provider here does", async () => {
      const res = await post({ model: MODEL, messages: [{ role: "user", content: "hi" }] });
      expect(res.status).toBe(400);

      const body = (await res.json()) as { error: { type: string; message: string } };
      expect(body.error.type).toBe("invalid_request_error");
      expect(body.error.message).toBe("max_tokens: Field required");
    });

    it("rejects a non-positive max_tokens", async () => {
      const res = await post({ model: MODEL, max_tokens: 0, messages: [{ role: "user", content: "hi" }] });
      expect(res.status).toBe(400);
    });

    it("rejects an empty messages list", async () => {
      const res = await post({ model: MODEL, max_tokens: 16, messages: [] });
      expect(res.status).toBe(400);
    });

    it("requires the conversation to open with the user", async () => {
      const res = await post({ model: MODEL, max_tokens: 16, messages: [{ role: "assistant", content: "hi" }] });
      expect(res.status).toBe(400);

      const body = (await res.json()) as { error: { message: string } };
      expect(body.error.message).toContain("first message must use the 'user' role");
    });

    it("allows consecutive same-role messages, which the API combines", async () => {
      const res = await post({
        model: MODEL,
        max_tokens: 16,
        messages: [
          { role: "user", content: "a" },
          { role: "user", content: "b" },
        ],
      });

      expect(res.status).toBe(200);
    });
  });
});
