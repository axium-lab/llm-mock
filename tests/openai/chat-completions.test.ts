import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { startTestServer, stopTestServer, type TestContext } from "./setup";

describe("chat completions", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestServer();
  });
  afterAll(() => stopTestServer(ctx));

  it("echoes the last user message by default", async () => {
    const completion = await ctx.client.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hello there" }],
    });
    expect(completion.object).toBe("chat.completion");
    expect(completion.id).toStartWith("chatcmpl-");
    expect(completion.choices[0]?.message.content).toBe("Echo: Hello there");
    expect(completion.choices[0]?.finish_reason).toBe("stop");
  });

  it("returns the canned response carried by the x-llm-mock-response header", async () => {
    const completion = await ctx.client.chat.completions.create(
      {
        model: "gpt-4o",
        messages: [{ role: "user", content: "What's the weather like?" }],
      },
      { headers: { "x-llm-mock-response": "It is sunny in Valencia." } },
    );
    expect(completion.choices[0]?.message.content).toBe("It is sunny in Valencia.");
  });

  it("reports coherent usage", async () => {
    const completion = await ctx.client.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: "Count my tokens please" }],
    });
    const usage = completion.usage!;
    expect(usage.prompt_tokens).toBeGreaterThan(0);
    expect(usage.completion_tokens).toBeGreaterThan(0);
    expect(usage.total_tokens).toBe(usage.prompt_tokens + usage.completion_tokens);
  });

  it("is idempotent: the same request produces the exact same completion", async () => {
    const request = {
      model: "gpt-4o",
      messages: [{ role: "user" as const, content: "Deterministic?" }],
    };
    const first = await ctx.client.chat.completions.create(request);
    const second = await ctx.client.chat.completions.create(request);
    expect(second).toEqual(first);
  });

  it("honors n by returning multiple choices", async () => {
    const completion = await ctx.client.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: "Give me three" }],
      n: 3,
    });
    expect(completion.choices).toHaveLength(3);
    expect(completion.choices.map((choice) => choice.index)).toEqual([0, 1, 2]);
  });
});
