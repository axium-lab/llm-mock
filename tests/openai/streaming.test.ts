import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { startTestServer, stopTestServer, type TestContext } from "./setup";

describe("streaming (SSE)", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestServer();
  });
  afterAll(() => stopTestServer(ctx));

  it("streams chat completion deltas that concatenate to the full content", async () => {
    const stream = await ctx.client.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: "Streaming test with a message long enough for several chunks" }],
      stream: true,
    });

    let text = "";
    let chunkCount = 0;
    let sawStop = false;
    for await (const chunk of stream) {
      chunkCount++;
      expect(chunk.object).toBe("chat.completion.chunk");
      text += chunk.choices[0]?.delta?.content ?? "";
      if (chunk.choices[0]?.finish_reason === "stop") sawStop = true;
    }

    expect(text).toBe("Echo: Streaming test with a message long enough for several chunks");
    expect(chunkCount).toBeGreaterThan(3);
    expect(sawStop).toBeTrue();
  });

  it("sends a final usage chunk when stream_options.include_usage is set", async () => {
    const stream = await ctx.client.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: "usage please" }],
      stream: true,
      stream_options: { include_usage: true },
    });

    let usageChunks = 0;
    for await (const chunk of stream) {
      if (chunk.usage) usageChunks++;
    }
    expect(usageChunks).toBe(1);
  });
});
