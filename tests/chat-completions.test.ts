import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { clearFixtures, registerFixture, startTestServer, stopTestServer, type TestContext } from "./setup";

describe("chat completions", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestServer();
  });
  afterAll(() => stopTestServer(ctx));
  afterEach(() => clearFixtures(ctx));

  it("echoes the last user message when no fixture matches", async () => {
    const completion = await ctx.client.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hello there" }],
    });
    expect(completion.object).toBe("chat.completion");
    expect(completion.id).toStartWith("chatcmpl-");
    expect(completion.choices[0]?.message.content).toBe("Echo: Hello there");
    expect(completion.choices[0]?.finish_reason).toBe("stop");
  });

  it("returns the fixture content when a fixture matches", async () => {
    await registerFixture(ctx, {
      match: { contains: "weather" },
      response: { content: "It is sunny in Valencia." },
    });
    const completion = await ctx.client.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: "What's the weather like?" }],
    });
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

  it("is deterministic: same request produces the same id and content", async () => {
    const request = {
      model: "gpt-4o",
      messages: [{ role: "user" as const, content: "Deterministic?" }],
    };
    const first = await ctx.client.chat.completions.create(request);
    const second = await ctx.client.chat.completions.create(request);
    expect(second.id).toBe(first.id);
    expect(second.choices[0]?.message.content).toBe(first.choices[0]?.message.content!);
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
