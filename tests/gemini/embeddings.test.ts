import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { startTestServer, stopTestServer, VALID_API_KEY, type TestContext } from "./setup";

const MODEL = "gemini-embedding-001";

describe("gemini embeddings", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestServer();
  });
  afterAll(() => stopTestServer(ctx));

  const post = (path: string, body: unknown) =>
    fetch(`${ctx.baseUrl}${path}`, {
      method: "POST",
      headers: { "x-goog-api-key": VALID_API_KEY, "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("embeds a single input at the model's native dimension", async () => {
    const response = await ctx.client.models.embedContent({ model: MODEL, contents: "hello" });

    expect(response.embeddings).toHaveLength(1);
    expect(response.embeddings?.[0]?.values).toHaveLength(3072);
  });

  it("returns unit vectors", async () => {
    const response = await ctx.client.models.embedContent({ model: MODEL, contents: "hello" });
    const values = response.embeddings?.[0]?.values ?? [];
    const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));

    expect(norm).toBeCloseTo(1, 6);
  });

  it("is deterministic per input", async () => {
    const response = await ctx.client.models.embedContent({
      model: MODEL,
      contents: ["hello", "world", "hello"],
    });
    const [first, second, third] = (response.embeddings ?? []).map((embedding) => embedding.values);

    expect(first).toEqual(third);
    expect(first).not.toEqual(second);
  });

  it("honors outputDimensionality", async () => {
    const response = await ctx.client.models.embedContent({
      model: MODEL,
      contents: "hello",
      config: { outputDimensionality: 768 },
    });

    expect(response.embeddings?.[0]?.values).toHaveLength(768);
  });

  it("uses the older models' native 768 dimensions", async () => {
    const response = await ctx.client.models.embedContent({ model: "text-embedding-004", contents: "hello" });

    expect(response.embeddings?.[0]?.values).toHaveLength(768);
  });

  it("goes through :batchEmbedContents, which is what the SDK calls", async () => {
    const res = await post(`/v1beta/models/${MODEL}:batchEmbedContents`, {
      requests: [
        { content: { role: "user", parts: [{ text: "hello" }] } },
        { content: { role: "user", parts: [{ text: "world" }] } },
      ],
    });
    const body = (await res.json()) as { embeddings: { values: number[] }[] };

    expect(body.embeddings).toHaveLength(2);
    expect(body.embeddings[0]?.values).toHaveLength(3072);
  });

  it("also serves the singular :embedContent, which curl callers use", async () => {
    const res = await post(`/v1beta/models/${MODEL}:embedContent`, {
      content: { parts: [{ text: "hello" }] },
    });
    const body = (await res.json()) as { embedding: { values: number[] } };

    // Singular in, singular out: one `embedding` object, not an `embeddings` list.
    expect(body.embedding.values).toHaveLength(3072);
  });

  it("agrees between the singular and batch forms for the same input", async () => {
    const [single, batch] = await Promise.all([
      post(`/v1beta/models/${MODEL}:embedContent`, { content: { parts: [{ text: "same" }] } }).then((r) => r.json()),
      post(`/v1beta/models/${MODEL}:batchEmbedContents`, {
        requests: [{ content: { parts: [{ text: "same" }] } }],
      }).then((r) => r.json()),
    ]);

    expect((single as { embedding: { values: number[] } }).embedding.values).toEqual(
      (batch as { embeddings: { values: number[] }[] }).embeddings[0]!.values,
    );
  });

  it("rejects a request with no content", async () => {
    const res = await post(`/v1beta/models/${MODEL}:embedContent`, {});
    expect(res.status).toBe(400);

    const body = (await res.json()) as { error: { message: string; status: string } };
    expect(body.error.status).toBe("INVALID_ARGUMENT");
    expect(body.error.message).toContain("content is not specified");
  });

  it("rejects an out-of-range outputDimensionality", async () => {
    const res = await post(`/v1beta/models/${MODEL}:embedContent`, {
      content: { parts: [{ text: "x" }] },
      outputDimensionality: 99999,
    });

    expect(res.status).toBe(400);
  });
});

describe("gemini countTokens", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestServer();
  });
  afterAll(() => stopTestServer(ctx));

  const post = (body: unknown) =>
    fetch(`${ctx.baseUrl}/v1beta/models/gemini-3.6-flash:countTokens`, {
      method: "POST",
      headers: { "x-goog-api-key": VALID_API_KEY, "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("counts a prompt through the SDK", async () => {
    const response = await ctx.client.models.countTokens({
      model: "gemini-3.6-flash",
      contents: "count me please",
    });

    expect(response.totalTokens).toBeGreaterThan(0);
  });

  it("grows with the length of the prompt", async () => {
    const [short, long] = await Promise.all([
      ctx.client.models.countTokens({ model: "gemini-3.6-flash", contents: "hi" }),
      ctx.client.models.countTokens({
        model: "gemini-3.6-flash",
        contents: "a substantially longer prompt than the other one",
      }),
    ]);

    expect(long.totalTokens).toBeGreaterThan(short.totalTokens ?? 0);
  });

  it("breaks the count down by modality", async () => {
    const res = await post({ contents: [{ role: "user", parts: [{ text: "hi" }] }] });
    const body = (await res.json()) as {
      totalTokens: number;
      promptTokensDetails: { modality: string; tokenCount: number }[];
    };

    expect(body.promptTokensDetails[0]).toEqual({ modality: "TEXT", tokenCount: body.totalTokens });
  });

  it("counts a whole generateContentRequest, system instruction included", async () => {
    const contents = [{ role: "user", parts: [{ text: "hi" }] }];
    const [plain, withSystem] = await Promise.all([
      post({ contents }).then((r) => r.json()),
      post({
        generateContentRequest: {
          contents,
          systemInstruction: { parts: [{ text: "You are a very terse assistant." }] },
        },
      }).then((r) => r.json()),
    ]);

    expect((withSystem as { totalTokens: number }).totalTokens).toBeGreaterThan(
      (plain as { totalTokens: number }).totalTokens,
    );
  });

  it("rejects a request with no contents", async () => {
    const res = await post({});
    expect(res.status).toBe(400);

    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("contents is not specified");
  });
});
