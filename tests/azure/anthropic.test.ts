import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import AnthropicFoundry from "@anthropic-ai/foundry-sdk";
import { INVALID_API_KEY, startTestServer, stopTestServer, VALID_API_KEY, type TestContext } from "./setup";

const MODEL = "claude-opus-5";
const ANTHROPIC_VERSION = "2023-06-01";

interface AnthropicErrorBody {
  type: "error";
  error: { type: string; message: string };
  request_id: string;
}

// Claude in Microsoft Foundry: the Messages API behind Azure's front door, at
// /azure/anthropic/v1/*. The Foundry SDK is the Anthropic SDK with Azure's
// credentials and without the resources Foundry does not offer.
describe("claude in microsoft foundry", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestServer();
  });
  afterAll(() => stopTestServer(ctx));

  const url = (path: string) => `${ctx.origin}/azure/anthropic${path}`;

  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(url(path), {
      method: "POST",
      headers: {
        "api-key": VALID_API_KEY,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
    });

  const hello = { model: MODEL, max_tokens: 1024, messages: [{ role: "user" as const, content: "Hello!" }] };

  it("answers through the Foundry SDK with a message of content blocks", async () => {
    const message = await ctx.claude.messages.create(hello);

    expect(message.type).toBe("message");
    expect(message.role).toBe("assistant");
    expect(message.model).toBe(MODEL);
    expect(message.stop_reason).toBe("end_turn");
    expect(message.content).toEqual([{ type: "text", text: "Echo: Hello!", citations: null }]);
    expect(message.usage.input_tokens).toBeGreaterThan(0);
  });

  it("streams named events that reassemble into the whole reply", async () => {
    const stream = ctx.claude.messages.stream({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: "user", content: "a prompt long enough to arrive in pieces" }],
    });

    let text = "";
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") text += event.delta.text;
    }
    expect(text).toBe("Echo: a prompt long enough to arrive in pieces");

    const final = await stream.finalMessage();
    expect(final.stop_reason).toBe("end_turn");
  });

  it("calls tools", async () => {
    const message = await ctx.claude.messages.create({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: "user", content: "weather in Valencia?" }],
      tools: [
        {
          name: "get_weather",
          input_schema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
        },
      ],
      tool_choice: { type: "any" },
    });

    expect(message.stop_reason).toBe("tool_use");
    const call = message.content.find((block) => block.type === "tool_use");
    expect(call?.type).toBe("tool_use");
    expect(call && "name" in call ? call.name : "").toBe("get_weather");
  });

  it("counts tokens", async () => {
    const count = await ctx.claude.messages.countTokens({
      model: MODEL,
      messages: [{ role: "user", content: "How many tokens is this?" }],
    });

    expect(count.input_tokens).toBeGreaterThan(0);
  });

  it("pins the reply with the x-llm-mock-response header", async () => {
    const message = await ctx.claude.messages.create(hello, { headers: { "x-llm-mock-response": "pinned!" } });
    expect(message.content).toEqual([{ type: "text", text: "pinned!", citations: null }]);
  });

  it("returns byte-identical responses for identical requests", async () => {
    const [first, second] = await Promise.all([
      post("/v1/messages", hello).then((r) => r.text()),
      post("/v1/messages", hello).then((r) => r.text()),
    ]);
    expect(first).toBe(second);
  });

  it("reports both correlation ids Foundry attaches", async () => {
    const res = await post("/v1/messages", hello);
    expect(res.status).toBe(200);

    // Anthropic's request id and the one API Management assigns on the way
    // through — the pair support asks for.
    expect(res.headers.get("request-id")).toBe(res.headers.get("x-request-id") ?? "");
    expect(res.headers.get("apim-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("rejects an invalid request in Anthropic's envelope", async () => {
    const res = await post("/v1/messages", { model: MODEL, messages: hello.messages });
    expect(res.status).toBe(400);

    const body = (await res.json()) as AnthropicErrorBody;
    expect(body.type).toBe("error");
    expect(body.error.type).toBe("invalid_request_error");
    expect(body.error.message).toBe("max_tokens: Field required");
    expect(body.request_id).toBe(res.headers.get("x-request-id") ?? "");
  });

  describe("authentication", () => {
    const models = (headers: Record<string, string>) =>
      post("/v1/messages", hello, headers).then((r) => r.status);

    it("accepts the key in the api-key header, Azure's own scheme", async () => {
      expect(await models({ "api-key": VALID_API_KEY })).toBe(200);
    });

    it("accepts the key in x-api-key, which is what the Foundry SDK sends", async () => {
      const res = await fetch(url("/v1/messages"), {
        method: "POST",
        headers: { "x-api-key": VALID_API_KEY, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json" },
        body: JSON.stringify(hello),
      });
      expect(res.status).toBe(200);
    });

    it("accepts a bearer token, which is how Entra ID callers authenticate", async () => {
      const res = await fetch(url("/v1/messages"), {
        method: "POST",
        headers: {
          authorization: `Bearer ${VALID_API_KEY}`,
          "anthropic-version": ANTHROPIC_VERSION,
          "content-type": "application/json",
        },
        body: JSON.stringify(hello),
      });
      expect(res.status).toBe(200);
    });

    it("rejects a missing credential in the gateway's flat shape, not Anthropic's", async () => {
      const res = await fetch(url("/v1/messages"), {
        method: "POST",
        headers: { "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json" },
        body: JSON.stringify(hello),
      });
      expect(res.status).toBe(401);

      const body = (await res.json()) as { statusCode: number; message: string; type?: unknown };
      expect(body.statusCode).toBe(401);
      expect(body.message).toContain("missing subscription key");
      expect(body.type).toBeUndefined();
    });

    it("rejects an invalid credential in Azure's wrapped shape", async () => {
      const res = await post("/v1/messages", hello, { "api-key": INVALID_API_KEY });
      expect(res.status).toBe(401);

      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe("401");
      expect(body.error.message).toContain("invalid subscription key");
    });

    it("surfaces the rejection through the SDK", async () => {
      const client = new AnthropicFoundry({
        baseURL: `${ctx.origin}/azure/anthropic`,
        apiKey: INVALID_API_KEY,
        maxRetries: 0,
      });
      try {
        await client.messages.create(hello);
        throw new Error("expected the request to fail");
      } catch (error) {
        expect((error as { status?: number }).status).toBe(401);
        expect((error as Error).message).toContain("invalid subscription key");
      }
    });

    it("still requires the anthropic-version header", async () => {
      const res = await fetch(url("/v1/messages"), {
        method: "POST",
        headers: { "api-key": VALID_API_KEY, "content-type": "application/json" },
        body: JSON.stringify(hello),
      });
      expect(res.status).toBe(400);

      const body = (await res.json()) as AnthropicErrorBody;
      expect(body.error.message).toBe("anthropic-version header is required");
    });
  });

  describe("what foundry does not offer", () => {
    const headers = { "api-key": VALID_API_KEY, "anthropic-version": ANTHROPIC_VERSION };

    it("has no Models API, which the SDK also leaves out", async () => {
      expect(ctx.claude.models).toBeUndefined();

      const res = await fetch(url("/v1/models"), { headers });
      expect(res.status).toBe(404);

      const body = (await res.json()) as AnthropicErrorBody;
      expect(body.error.type).toBe("not_found_error");
    });

    it("has no Message Batches", async () => {
      const res = await post("/v1/messages/batches", { requests: [] });
      expect(res.status).toBe(404);
    });

    it("has no Files API", async () => {
      const res = await fetch(url("/v1/files"), { headers: { ...headers, "anthropic-beta": "files-api-2025-04-14" } });
      expect(res.status).toBe(404);
    });
  });
});
