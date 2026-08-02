import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { startTestServer, stopTestServer, VALID_API_KEY, type TestContext } from "./setup";

interface ErrorBody {
  error: { message: string; type: string; code: string | null };
}

describe("provider routing", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestServer();
  });
  afterAll(() => stopTestServer(ctx));

  it("the bare /v1 prefix no longer exists", async () => {
    const origin = ctx.baseURL.replace("/openai/v1", "");
    const res = await fetch(`${origin}/v1/models`, {
      headers: { Authorization: `Bearer ${VALID_API_KEY}` },
    });
    expect(res.status).toBe(404);
  });

  it("unknown URLs under /openai use the OpenAI error envelope", async () => {
    const res = await fetch(`${ctx.baseURL}/nope`, {
      headers: { Authorization: `Bearer ${VALID_API_KEY}` },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.type).toBe("invalid_request_error");
    expect(body.error.code).toBe("unknown_url");
    expect(body.error.message).toContain("/openai/v1/nope");
  });
});

describe("statelessness", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestServer();
  });
  afterAll(() => stopTestServer(ctx));

  it("identical requests produce byte-identical responses", async () => {
    const request = () =>
      fetch(`${ctx.baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${VALID_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: "Same bytes?" }] }),
      });
    const first = await (await request()).text();
    const second = await (await request()).text();
    expect(second).toBe(first);
  });

  it("the canned response changes the completion id, so responses stay self-consistent", async () => {
    const base = { model: "gpt-4o", messages: [{ role: "user" as const, content: "hi" }] };
    const echoed = await ctx.client.chat.completions.create(base);
    const canned = await ctx.client.chat.completions.create(base, {
      headers: { "x-llm-mock-response": "Different content" },
    });
    expect(canned.id).not.toBe(echoed.id);
  });

  it("x-llm-mock-response-base64 carries UTF-8 content and wins over the plain header", async () => {
    const utf8 = "Soleado en Valencia — 30°C ☀️";
    const completion = await ctx.client.chat.completions.create(
      { model: "gpt-4o", messages: [{ role: "user", content: "weather?" }] },
      {
        headers: {
          "x-llm-mock-response": "plain loses",
          "x-llm-mock-response-base64": Buffer.from(utf8, "utf-8").toString("base64"),
        },
      },
    );
    expect(completion.choices[0]?.message.content).toBe(utf8);
  });

  it("the /__mock admin API is gone", async () => {
    const origin = ctx.baseURL.replace("/openai/v1", "");
    const res = await fetch(`${origin}/__mock/fixtures`);
    expect(res.status).toBe(404);
  });
});
