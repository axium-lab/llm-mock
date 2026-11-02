import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { startTestServer, stopTestServer, VALID_API_KEY, type TestContext } from "./setup";

const MODEL = "gpt-3.5-turbo-instruct";

describe("completions", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestServer();
  });
  afterAll(() => stopTestServer(ctx));

  const post = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${ctx.baseURL}/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${VALID_API_KEY}`, "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });

  it("echoes the prompt by default", async () => {
    const completion = await ctx.client.completions.create({ model: MODEL, prompt: "Say hi" });

    expect(completion.object).toBe("text_completion");
    expect(completion.id).toStartWith("cmpl-");
    expect(completion.model).toBe(MODEL);
    expect(completion.choices[0]).toEqual({ text: "Echo: Say hi", index: 0, logprobs: null, finish_reason: "stop" });
    expect(completion.usage?.total_tokens).toBeGreaterThan(0);
  });

  it("returns the canned response carried by the x-llm-mock-response header", async () => {
    const completion = await ctx.client.completions.create(
      { model: MODEL, prompt: "Say hi" },
      { headers: { "x-llm-mock-response": "pinned!" } },
    );
    expect(completion.choices[0]?.text).toBe("pinned!");
  });

  it("gives every prompt its own choices, n at a time", async () => {
    const completion = await ctx.client.completions.create({ model: MODEL, prompt: ["one", "two"], n: 2 });

    expect(completion.choices.map((choice) => choice.index)).toEqual([0, 1, 2, 3]);
    expect(completion.choices.map((choice) => choice.text)).toEqual(["Echo: one", "Echo: one", "Echo: two", "Echo: two"]);
  });

  it("accepts a token list and no prompt at all", async () => {
    const tokens = await ctx.client.completions.create({ model: MODEL, prompt: [1212, 318, 257] });
    expect(tokens.choices[0]?.text).toBe("Echo: 1212 318 257");

    // The SDK's types insist on a prompt; the API itself does not.
    const none = (await post({ model: MODEL }).then((r) => r.json())) as { choices: { text: string }[] };
    expect(none.choices[0]?.text).toBe("Hello from llm-mock!");
  });

  it("prepends the prompt when asked to echo", async () => {
    const completion = await ctx.client.completions.create({ model: MODEL, prompt: "Say hi", echo: true });
    expect(completion.choices[0]?.text).toBe("Say hiEcho: Say hi");
  });

  it("streams text_completion chunks ending with [DONE]", async () => {
    const stream = await ctx.client.completions.create({ model: MODEL, prompt: "stream this please", stream: true });

    let text = "";
    let last: string | null = null;
    for await (const chunk of stream) {
      expect(chunk.object).toBe("text_completion");
      text += chunk.choices[0]?.text ?? "";
      last = chunk.choices[0]?.finish_reason ?? last;
    }
    expect(text).toBe("Echo: stream this please");
    expect(last).toBe("stop");

    const rawText = await post({ model: MODEL, prompt: "x", stream: true }).then((r) => r.text());
    expect(rawText.trimEnd().endsWith("data: [DONE]")).toBe(true);
  });

  it("trails a usage chunk when stream_options asks for it", async () => {
    const stream = await ctx.client.completions.create({
      model: MODEL,
      prompt: "count",
      stream: true,
      stream_options: { include_usage: true },
    });
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);

    const trailer = chunks[chunks.length - 1]!;
    expect(trailer.choices).toEqual([]);
    expect(trailer.usage?.total_tokens).toBeGreaterThan(0);
  });

  it("rejects a request with no model", async () => {
    const res = await post({ prompt: "hi" });
    expect(res.status).toBe(400);

    const body = (await res.json()) as { error: { param: string } };
    expect(body.error.param).toBe("model");
  });

  it("returns byte-identical responses for identical requests", async () => {
    const [first, second] = await Promise.all([
      post({ model: MODEL, prompt: "same" }).then((r) => r.text()),
      post({ model: MODEL, prompt: "same" }).then((r) => r.text()),
    ]);
    expect(first).toBe(second);
  });
});
