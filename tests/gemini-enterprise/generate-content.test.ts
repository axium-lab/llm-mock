import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { FinishReason, Type, type FunctionDeclaration } from "@google/genai";
import { LOCATION, PROJECT, startTestServer, stopTestServer, VALID_API_KEY, type TestContext } from "./setup";

const MODEL = "gemini-3.6-flash";

const WEATHER: FunctionDeclaration = {
  name: "get_weather",
  parameters: {
    type: Type.OBJECT,
    properties: { city: { type: Type.STRING }, unit: { type: Type.STRING, enum: ["celsius", "fahrenheit"] } },
    required: ["city", "unit"],
  },
};

describe("gemini-enterprise generateContent", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestServer();
  });
  afterAll(() => stopTestServer(ctx));

  const regionalPath = `/v1beta1/projects/${PROJECT}/locations/${LOCATION}/publishers/google/models`;
  const expressPath = "/v1beta1/publishers/google/models";

  const post = (path: string, body: unknown) =>
    fetch(`${ctx.baseUrl}${path}`, {
      method: "POST",
      headers: { "x-goog-api-key": VALID_API_KEY, "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("answers through the express client", async () => {
    const response = await ctx.express.models.generateContent({ model: MODEL, contents: "Hello!" });
    expect(response.text).toBe("Echo: Hello!");
  });

  it("answers through the regional client, on its longer path", async () => {
    const response = await ctx.regional.models.generateContent({ model: MODEL, contents: "Hello!" });
    expect(response.text).toBe("Echo: Hello!");
  });

  it("gives both modes the same answer for the same request", async () => {
    const [regional, express] = await Promise.all([
      ctx.regional.models.generateContent({ model: MODEL, contents: "Hello!" }),
      ctx.express.models.generateContent({ model: MODEL, contents: "Hello!" }),
    ]);

    expect(regional.responseId).toBe(express.responseId ?? "");
    expect(regional.createTime).toBe(express.createTime ?? "");
  });

  it("stamps a createTime, which AI Studio does not send", async () => {
    const response = await ctx.express.models.generateContent({ model: MODEL, contents: "Hello!" });

    expect(response.createTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it("keeps the shared candidate shape", async () => {
    const response = await ctx.express.models.generateContent({ model: MODEL, contents: "Hello!" });
    const candidate = response.candidates?.[0];

    expect(candidate?.content?.role).toBe("model");
    expect(candidate?.finishReason).toBe(FinishReason.STOP);
    expect(response.usageMetadata?.totalTokenCount).toBeGreaterThan(0);
  });

  it("honors candidateCount", async () => {
    const response = await ctx.express.models.generateContent({
      model: MODEL,
      contents: "Hello!",
      config: { candidateCount: 2 },
    });
    expect(response.candidates).toHaveLength(2);
  });

  it("forces tool calls through toolConfig, as on the AI Studio surface", async () => {
    const response = await ctx.regional.models.generateContent({
      model: MODEL,
      contents: "weather?",
      config: {
        tools: [{ functionDeclarations: [WEATHER] }],
        toolConfig: { functionCallingConfig: { mode: "ANY" as never } },
      },
    });

    expect(response.functionCalls?.[0]).toMatchObject({
      name: "get_weather",
      args: { city: "mock", unit: "celsius" },
    });
  });

  it("pins the reply with the x-llm-mock-response header", async () => {
    const res = await fetch(`${ctx.baseUrl}${expressPath}/${MODEL}:generateContent`, {
      method: "POST",
      headers: {
        "x-goog-api-key": VALID_API_KEY,
        "content-type": "application/json",
        "x-llm-mock-response": "pinned!",
      },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "hi" }] }] }),
    });
    const body = (await res.json()) as { candidates: { content: { parts: { text: string }[] } }[] };

    expect(body.candidates[0]?.content.parts[0]?.text).toBe("pinned!");
  });

  it("serves the same body on both path shapes", async () => {
    const payload = { contents: [{ role: "user", parts: [{ text: "hi" }] }] };
    const [regional, express] = await Promise.all([
      post(`${regionalPath}/${MODEL}:generateContent`, payload).then((r) => r.json()),
      post(`${expressPath}/${MODEL}:generateContent`, payload).then((r) => r.json()),
    ]);

    expect(regional).toEqual(express);
  });

  it("rejects a request with no contents", async () => {
    const res = await post(`${expressPath}/${MODEL}:generateContent`, {});
    expect(res.status).toBe(400);

    const body = (await res.json()) as { error: { message: string; status: string } };
    expect(body.error.status).toBe("INVALID_ARGUMENT");
    expect(body.error.message).toContain("contents is not specified");
  });

  it("returns byte-identical responses for identical requests", async () => {
    const payload = { contents: [{ role: "user", parts: [{ text: "same" }] }] };
    const [first, second] = await Promise.all([
      post(`${expressPath}/${MODEL}:generateContent`, payload).then((r) => r.text()),
      post(`${expressPath}/${MODEL}:generateContent`, payload).then((r) => r.text()),
    ]);

    expect(first).toBe(second);
  });

  describe("streaming", () => {
    it("streams in pieces that reassemble", async () => {
      const stream = await ctx.regional.models.generateContentStream({
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

    it("stamps every chunk with a createTime", async () => {
      const stream = await ctx.express.models.generateContentStream({ model: MODEL, contents: "stream me" });

      for await (const chunk of stream) {
        expect(chunk.createTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      }
    });

    it("emits SSE without a [DONE] sentinel", async () => {
      const res = await post(`${expressPath}/${MODEL}:streamGenerateContent?alt=sse`, {
        contents: [{ role: "user", parts: [{ text: "hi" }] }],
      });

      expect(res.headers.get("content-type")).toContain("text/event-stream");
      const raw = await res.text();
      expect(raw).not.toContain("[DONE]");
    });

    it("streams a JSON array when alt=sse is absent", async () => {
      const res = await post(`${expressPath}/${MODEL}:streamGenerateContent`, {
        contents: [{ role: "user", parts: [{ text: "hi there, stream this" }] }],
      });

      expect(res.headers.get("content-type")).toContain("application/json");
      const chunks = (await res.json()) as { candidates: { content: { parts: { text?: string }[] } }[] }[];
      const text = chunks.map((chunk) => chunk.candidates[0]?.content.parts[0]?.text ?? "").join("");
      expect(text).toBe("Echo: hi there, stream this");
    });
  });
});
