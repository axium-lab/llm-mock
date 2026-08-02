import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { FinishReason, MediaModality } from "@google/genai";
import { startTestServer, stopTestServer, VALID_API_KEY, type TestContext } from "./setup";

const MODEL = "gemini-3.6-flash";

describe("gemini generateContent", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestServer();
  });
  afterAll(() => stopTestServer(ctx));

  const post = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${ctx.baseUrl}/v1beta/models/${MODEL}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": VALID_API_KEY, "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });

  it("echoes the last user turn through the SDK", async () => {
    const response = await ctx.client.models.generateContent({ model: MODEL, contents: "Hello!" });
    expect(response.text).toBe("Echo: Hello!");
  });

  it("answers with a model-role candidate and a STOP finish reason", async () => {
    const response = await ctx.client.models.generateContent({ model: MODEL, contents: "Hello!" });
    const candidate = response.candidates?.[0];

    expect(candidate?.content?.role).toBe("model");
    expect(candidate?.content?.parts?.[0]?.text).toBe("Echo: Hello!");
    expect(candidate?.finishReason).toBe(FinishReason.STOP);
    expect(candidate?.index).toBe(0);
  });

  it("reports usage split by modality, plus modelVersion and responseId", async () => {
    const response = await ctx.client.models.generateContent({ model: MODEL, contents: "Hello!" });
    const usage = response.usageMetadata;

    expect(usage?.totalTokenCount).toBe((usage?.promptTokenCount ?? 0) + (usage?.candidatesTokenCount ?? 0));
    expect(usage?.promptTokensDetails?.[0]?.modality).toBe(MediaModality.TEXT);
    expect(response.modelVersion).toBe(MODEL);
    expect(response.responseId).toBeTruthy();
  });

  it("echoes the last user turn of a multi-turn conversation", async () => {
    const response = await ctx.client.models.generateContent({
      model: MODEL,
      contents: [
        { role: "user", parts: [{ text: "first" }] },
        { role: "model", parts: [{ text: "ack" }] },
        { role: "user", parts: [{ text: "second" }] },
      ],
    });
    expect(response.text).toBe("Echo: second");
  });

  it("honors candidateCount", async () => {
    const response = await ctx.client.models.generateContent({
      model: MODEL,
      contents: "Hello!",
      config: { candidateCount: 3 },
    });
    expect(response.candidates).toHaveLength(3);
    expect(response.candidates?.map((candidate) => candidate.index)).toEqual([0, 1, 2]);
  });

  it("counts the system instruction towards the prompt tokens", async () => {
    const [plain, withSystem] = await Promise.all([
      ctx.client.models.generateContent({ model: MODEL, contents: "Hello!" }),
      ctx.client.models.generateContent({
        model: MODEL,
        contents: "Hello!",
        config: { systemInstruction: "You are a very terse assistant." },
      }),
    ]);
    expect(withSystem.usageMetadata?.promptTokenCount).toBeGreaterThan(
      plain.usageMetadata?.promptTokenCount ?? 0,
    );
  });

  it("pins the reply with the x-llm-mock-response header", async () => {
    const res = await post({ contents: [{ role: "user", parts: [{ text: "hi" }] }] }, { "x-llm-mock-response": "pinned!" });
    const body = (await res.json()) as { candidates: { content: { parts: { text: string }[] } }[] };

    expect(body.candidates[0]?.content.parts[0]?.text).toBe("pinned!");
  });

  it("accepts any model id, the way the OpenAI provider does", async () => {
    const response = await ctx.client.models.generateContent({
      model: "gemini-not-in-the-catalog",
      contents: "Hello!",
    });
    expect(response.modelVersion).toBe("gemini-not-in-the-catalog");
  });

  it("rejects a request with no contents the way the real API does", async () => {
    const res = await post({});
    expect(res.status).toBe(400);

    const body = (await res.json()) as { error: { message: string; status: string } };
    expect(body.error.status).toBe("INVALID_ARGUMENT");
    expect(body.error.message).toContain("contents is not specified");
  });

  it("returns byte-identical responses for identical requests", async () => {
    const payload = { contents: [{ role: "user", parts: [{ text: "same" }] }] };
    const [first, second] = await Promise.all([post(payload).then((r) => r.text()), post(payload).then((r) => r.text())]);
    expect(first).toBe(second);
  });
});
