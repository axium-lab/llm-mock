import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { headers, startTestServer, stopTestServer, type TestContext } from "./setup";

const MODEL = "claude-opus-5";

describe("anthropic count_tokens", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestServer();
  });
  afterAll(() => stopTestServer(ctx));

  const post = (body: unknown) =>
    fetch(`${ctx.baseURL}/v1/messages/count_tokens`, {
      method: "POST",
      headers: { ...headers(), "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("returns the token count of a prompt", async () => {
    const count = await ctx.client.messages.countTokens({
      model: MODEL,
      messages: [{ role: "user", content: "How many tokens is this?" }],
    });

    expect(count.input_tokens).toBeGreaterThan(0);
    expect(Object.keys(count)).toEqual(["input_tokens"]);
  });

  it("grows with the length of the prompt", async () => {
    const short = await ctx.client.messages.countTokens({
      model: MODEL,
      messages: [{ role: "user", content: "hi" }],
    });
    const long = await ctx.client.messages.countTokens({
      model: MODEL,
      messages: [{ role: "user", content: "a considerably longer prompt than the previous one" }],
    });

    expect(long.input_tokens).toBeGreaterThan(short.input_tokens);
  });

  it("counts the system prompt and the tool declarations too", async () => {
    const bare = await ctx.client.messages.countTokens({
      model: MODEL,
      messages: [{ role: "user", content: "hello" }],
    });
    const withSystem = await ctx.client.messages.countTokens({
      model: MODEL,
      system: "You are a helpful assistant that answers briefly.",
      messages: [{ role: "user", content: "hello" }],
    });
    const withTools = await ctx.client.messages.countTokens({
      model: MODEL,
      messages: [{ role: "user", content: "hello" }],
      tools: [
        {
          name: "get_weather",
          description: "Get the weather for a city",
          input_schema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
        },
      ],
    });

    expect(withSystem.input_tokens).toBeGreaterThan(bare.input_tokens);
    expect(withTools.input_tokens).toBeGreaterThan(bare.input_tokens);
  });

  it("agrees with the usage the messages endpoint reports", async () => {
    const request = {
      model: MODEL,
      messages: [{ role: "user" as const, content: "Count me before you send me." }],
    };
    const count = await ctx.client.messages.countTokens(request);
    const message = await ctx.client.messages.create({ ...request, max_tokens: 1024 });

    expect(count.input_tokens).toBe(message.usage.input_tokens);
  });

  it("is deterministic", async () => {
    const body = { model: MODEL, messages: [{ role: "user", content: "same bytes every time" }] };
    const [a, b] = await Promise.all([post(body).then((r) => r.text()), post(body).then((r) => r.text())]);
    expect(a).toBe(b);
  });

  it("rejects a request without messages", async () => {
    const response = await post({ model: MODEL });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { type: string; message: string } };
    expect(body.error.type).toBe("invalid_request_error");
    expect(body.error.message).toContain("messages");
  });

  it("rejects a request without a model", async () => {
    const response = await post({ messages: [{ role: "user", content: "hi" }] });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toContain("model");
  });
});
