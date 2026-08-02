import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { API_VERSION, startTestServer, stopTestServer, VALID_API_KEY, type TestContext } from "./setup";

const DEPLOYMENT = "my-gpt4o-deployment";

describe("azure chat completions", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestServer();
  });
  afterAll(() => stopTestServer(ctx));

  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${ctx.baseUrl}${path}`, {
      method: "POST",
      headers: { "api-key": VALID_API_KEY, "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });

  const chatPath = `/deployments/${DEPLOYMENT}/chat/completions?api-version=${API_VERSION}`;

  it("answers through the SDK in OpenAI's shape", async () => {
    const completion = await ctx.classic.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hello!" }],
    });

    expect(completion.object).toBe("chat.completion");
    expect(completion.choices[0]?.message.content).toBe("Echo: Hello!");
    expect(completion.usage?.total_tokens).toBeGreaterThan(0);
  });

  it("echoes the body's model, not the deployment name", async () => {
    const res = await post(chatPath, {
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "hi" }],
    });
    const body = (await res.json()) as { model: string };

    // The deployment routes the call; the model is what the client asked for.
    expect(body.model).toBe("gpt-4o-mini");
  });

  it("streams with the [DONE] sentinel Azure also sends", async () => {
    const stream = await ctx.classic.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: "stream this please" }],
      stream: true,
    });

    let text = "";
    for await (const chunk of stream) text += chunk.choices[0]?.delta.content ?? "";
    expect(text).toBe("Echo: stream this please");

    const raw = await post(chatPath, {
      model: "gpt-4o",
      messages: [{ role: "user", content: "x" }],
      stream: true,
    });
    expect(await raw.text()).toContain("data: [DONE]");
  });

  it("returns tool calls", async () => {
    const completion = await ctx.classic.chat.completions.create({
      model: "gpt-4o",
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
    expect(call && "function" in call ? call.function.name : "").toBe("get_weather");
  });

  it("pins the reply with the x-llm-mock-response header", async () => {
    const res = await post(
      chatPath,
      { model: "gpt-4o", messages: [{ role: "user", content: "hi" }] },
      { "x-llm-mock-response": "pinned!" },
    );
    const body = (await res.json()) as { choices: { message: { content: string } }[] };

    expect(body.choices[0]?.message.content).toBe("pinned!");
  });

  it("rejects a request with no messages, in Azure's envelope", async () => {
    const res = await post(chatPath, { model: "gpt-4o" });
    expect(res.status).toBe(400);

    const body = (await res.json()) as { error: { code: string; param: string } };
    expect(body.error.code).toBe("BadRequest");
    expect(body.error.param).toBe("messages");
  });

  it("returns byte-identical responses for identical requests", async () => {
    const payload = { model: "gpt-4o", messages: [{ role: "user", content: "same" }] };
    const [first, second] = await Promise.all([
      post(chatPath, payload).then((r) => r.text()),
      post(chatPath, payload).then((r) => r.text()),
    ]);

    expect(first).toBe(second);
  });
});

describe("azure embeddings", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestServer();
  });
  afterAll(() => stopTestServer(ctx));

  it("embeds at the model's dimension through the SDK", async () => {
    const response = await ctx.classic.embeddings.create({
      model: "text-embedding-3-small",
      input: "hello",
    });

    expect(response.data[0]?.embedding).toHaveLength(1536);
    expect(response.object).toBe("list");
  });

  it("is deterministic per input", async () => {
    const response = await ctx.classic.embeddings.create({
      model: "text-embedding-3-small",
      input: ["hello", "world", "hello"],
      encoding_format: "float",
    });
    const [first, second, third] = response.data.map((item) => item.embedding);

    expect(first).toEqual(third);
    expect(first).not.toEqual(second);
  });

  it("rejects a request with no input", async () => {
    const res = await fetch(
      `${ctx.baseUrl}/deployments/${DEPLOYMENT}/embeddings?api-version=${API_VERSION}`,
      {
        method: "POST",
        headers: { "api-key": VALID_API_KEY, "content-type": "application/json" },
        body: JSON.stringify({ model: "text-embedding-3-small" }),
      },
    );
    expect(res.status).toBe(400);

    const body = (await res.json()) as { error: { param: string } };
    expect(body.error.param).toBe("input");
  });
});
