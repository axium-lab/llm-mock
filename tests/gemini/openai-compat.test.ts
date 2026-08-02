import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import OpenAI, { NotFoundError } from "openai";
import { INVALID_API_KEY, startServer, stopServer, VALID_API_KEY } from "../server";

const MODEL = "gemini-3.6-flash";

// Google serves an OpenAI-compatible surface at /v1beta/openai, so the client
// here is the `openai` SDK pointed at the Gemini prefix.
describe("gemini OpenAI-compatibility layer", () => {
  let server: Server;
  let geminiOrigin: string;
  let baseURL: string;
  let client: OpenAI;

  beforeAll(async () => {
    const started = await startServer();
    server = started.server;
    geminiOrigin = `${started.origin}/gemini`;
    baseURL = `${geminiOrigin}/v1beta/openai`;
    client = new OpenAI({ apiKey: VALID_API_KEY, baseURL, maxRetries: 0 });
  });
  afterAll(() => stopServer(server));

  it("answers chat completions in OpenAI's shape", async () => {
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: "Hello!" }],
    });

    expect(completion.object).toBe("chat.completion");
    expect(completion.choices[0]?.message.content).toBe("Echo: Hello!");
    expect(completion.model).toBe(MODEL);
    expect(completion.usage?.total_tokens).toBeGreaterThan(0);
  });

  it("streams with the [DONE] sentinel the OpenAI SDK waits for", async () => {
    const stream = await client.chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: "stream this please" }],
      stream: true,
    });

    let text = "";
    for await (const chunk of stream) text += chunk.choices[0]?.delta.content ?? "";
    expect(text).toBe("Echo: stream this please");

    const raw = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${VALID_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: "x" }], stream: true }),
    });
    expect(await raw.text()).toContain("data: [DONE]");
  });

  it("returns tool calls with JSON-string arguments, as OpenAI does", async () => {
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: "weather?" }],
      tools: [
        {
          type: "function",
          function: {
            name: "get_weather",
            parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
          },
        },
      ],
      tool_choice: "required",
    });
    const call = completion.choices[0]?.message.tool_calls?.[0];

    expect(call?.type).toBe("function");
    // A JSON string here, where the native Gemini surface sends a decoded object.
    expect(call && "function" in call ? call.function.arguments : "").toBe('{"city":"mock"}');
  });

  it("embeds at Gemini's dimensions, not OpenAI's 1536 default", async () => {
    const response = await client.embeddings.create({ model: "gemini-embedding-001", input: "hello" });

    expect(response.data[0]?.embedding).toHaveLength(3072);
  });

  it("lists Gemini models, not OpenAI's catalog", async () => {
    const models = await client.models.list();
    const ids = models.data.map((model) => model.id);

    expect(ids).toContain("models/gemini-3.6-flash");
    expect(ids).not.toContain("gpt-4o");
    expect(models.data[0]?.owned_by).toBe("google");
  });

  it("retrieves a model by bare id or by resource name", async () => {
    const [bare, prefixed] = await Promise.all([
      client.models.retrieve(MODEL),
      client.models.retrieve(`models/${MODEL}`),
    ]);

    expect(bare.id).toBe(`models/${MODEL}`);
    expect(prefixed.id).toBe(`models/${MODEL}`);
  });

  it("404s an OpenAI model, which this layer does not serve", async () => {
    try {
      await client.models.retrieve("gpt-4o");
      throw new Error("expected the request to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundError);
      expect((error as NotFoundError).code).toBe("model_not_found");
    }
  });

  it("does not expose the Responses API, absent from the real compat layer", async () => {
    const res = await fetch(`${baseURL}/responses`, {
      method: "POST",
      headers: { authorization: `Bearer ${VALID_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, input: "hi" }),
    });

    expect(res.status).toBe(404);
  });

  it("does not expose Files, which stay on the native surface", async () => {
    const res = await fetch(`${baseURL}/files`, { headers: { authorization: `Bearer ${VALID_API_KEY}` } });
    expect(res.status).toBe(404);
  });

  it("reports validation errors in OpenAI's envelope", async () => {
    const res = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${VALID_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL }),
    });
    expect(res.status).toBe(400);

    const body = (await res.json()) as { error: { type: string; param: string | null; status?: string } };
    expect(body.error.type).toBe("invalid_request_error");
    expect(body.error.param).toBe("messages");
    expect(body.error.status).toBeUndefined();
  });

  it("reports a bad key in Google's envelope, since auth is checked upstream", async () => {
    const res = await fetch(`${baseURL}/models`, {
      headers: { authorization: `Bearer ${INVALID_API_KEY}` },
    });
    expect(res.status).toBe(400);

    const body = (await res.json()) as { error: { status: string; code: unknown } };
    expect(body.error.status).toBe("INVALID_ARGUMENT");
    expect(body.error.code).toBe(400);
  });

  it("leaves the native Gemini surface untouched", async () => {
    const res = await fetch(`${geminiOrigin}/v1beta/models/${MODEL}`, {
      headers: { "x-goog-api-key": VALID_API_KEY },
    });
    const body = (await res.json()) as { name: string; supportedGenerationMethods: string[] };

    expect(body.name).toBe(`models/${MODEL}`);
    expect(body.supportedGenerationMethods).toContain("generateContent");
  });
});
