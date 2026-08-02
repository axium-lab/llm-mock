import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { startTestServer, stopTestServer, VALID_API_KEY, type TestContext } from "./setup";

const MODEL = "gemini-3.6-flash";

describe("gemini streamGenerateContent", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestServer();
  });
  afterAll(() => stopTestServer(ctx));

  it("streams the reply in pieces that reassemble into the full text", async () => {
    const stream = await ctx.client.models.generateContentStream({
      model: MODEL,
      contents: "a prompt long enough to arrive in several pieces",
    });

    let text = "";
    let chunks = 0;
    for await (const chunk of stream) {
      text += chunk.text ?? "";
      chunks += 1;
    }

    expect(text).toBe("Echo: a prompt long enough to arrive in several pieces");
    expect(chunks).toBeGreaterThan(1);
  });

  it("carries finishReason and usage only on the final chunk", async () => {
    const stream = await ctx.client.models.generateContentStream({ model: MODEL, contents: "stream me" });

    const finishReasons: (string | undefined)[] = [];
    const usageChunks: number[] = [];
    let index = 0;
    for await (const chunk of stream) {
      finishReasons.push(chunk.candidates?.[0]?.finishReason);
      if (chunk.usageMetadata) usageChunks.push(index);
      index += 1;
    }

    expect(finishReasons.slice(0, -1).every((reason) => reason === undefined)).toBe(true);
    expect(finishReasons.at(-1)).toBe("STOP");
    expect(usageChunks).toEqual([index - 1]);
  });

  it("emits SSE without OpenAI's [DONE] sentinel, which the SDK cannot parse", async () => {
    const res = await fetch(`${ctx.baseUrl}/v1beta/models/${MODEL}:streamGenerateContent?alt=sse`, {
      method: "POST",
      headers: { "x-goog-api-key": VALID_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "hi" }] }] }),
    });

    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const raw = await res.text();
    expect(raw).not.toContain("[DONE]");
    for (const line of raw.split("\n\n").filter(Boolean)) {
      expect(() => JSON.parse(line.replace(/^data: /, ""))).not.toThrow();
    }
  });

  it("streams a JSON array instead of events when alt=sse is absent", async () => {
    const res = await fetch(`${ctx.baseUrl}/v1beta/models/${MODEL}:streamGenerateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": VALID_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "hi there, stream this" }] }] }),
    });

    expect(res.headers.get("content-type")).toContain("application/json");
    const chunks = (await res.json()) as { candidates: { content: { parts: { text?: string }[] } }[] }[];
    const text = chunks.map((chunk) => chunk.candidates[0]?.content.parts[0]?.text ?? "").join("");
    expect(text).toBe("Echo: hi there, stream this");
  });

  it("streams the same text the non-streaming call returns", async () => {
    const [whole, stream] = await Promise.all([
      ctx.client.models.generateContent({ model: MODEL, contents: "consistency check" }),
      ctx.client.models.generateContentStream({ model: MODEL, contents: "consistency check" }),
    ]);

    let streamed = "";
    for await (const chunk of stream) streamed += chunk.text ?? "";
    expect(whole.text).toBe(streamed);
  });
});
