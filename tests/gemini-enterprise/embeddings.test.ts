import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { startTestServer, stopTestServer, VALID_API_KEY, type TestContext } from "./setup";

const EMBED = "text-embedding-005";
const MODELS = "/v1beta1/publishers/google/models";

describe("gemini-enterprise embeddings", () => {
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

  it("embeds at the model's native dimension", async () => {
    const response = await ctx.express.models.embedContent({ model: EMBED, contents: "hello" });

    expect(response.embeddings).toHaveLength(1);
    expect(response.embeddings?.[0]?.values).toHaveLength(768);
  });

  it("returns unit vectors", async () => {
    const response = await ctx.regional.models.embedContent({ model: EMBED, contents: "hello" });
    const values = response.embeddings?.[0]?.values ?? [];
    const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));

    expect(norm).toBeCloseTo(1, 6);
  });

  it("is deterministic per input", async () => {
    const response = await ctx.express.models.embedContent({
      model: EMBED,
      contents: ["hello", "world", "hello"],
    });
    const [first, second, third] = (response.embeddings ?? []).map((embedding) => embedding.values);

    expect(first).toEqual(third);
    expect(first).not.toEqual(second);
  });

  it("gives gemini-embedding-001 its 3072 dimensions", async () => {
    const response = await ctx.express.models.embedContent({ model: "gemini-embedding-001", contents: "hello" });

    expect(response.embeddings?.[0]?.values).toHaveLength(3072);
  });

  it("honors outputDimensionality, which rides in `parameters` not per instance", async () => {
    const response = await ctx.express.models.embedContent({
      model: "gemini-embedding-001",
      contents: "hello",
      config: { outputDimensionality: 1536 },
    });

    expect(response.embeddings?.[0]?.values).toHaveLength(1536);
  });

  it("reports statistics the SDK can read back", async () => {
    const response = await ctx.express.models.embedContent({ model: EMBED, contents: "hello" });

    expect(response.embeddings?.[0]?.statistics).toMatchObject({ truncated: false });
    expect(response.embeddings?.[0]?.statistics?.tokenCount).toBeGreaterThan(0);
  });

  it("wraps everything in the instances/predictions envelope, not :embedContent's", async () => {
    const res = await post(`${MODELS}/${EMBED}:predict`, {
      instances: [{ content: "hola", task_type: "SEMANTIC_SIMILARITY" }],
      parameters: { outputDimensionality: 4 },
    });
    const body = (await res.json()) as {
      predictions: { embeddings: { values: number[]; statistics: Record<string, unknown> } }[];
    };

    expect(body.predictions).toHaveLength(1);
    expect(body.predictions[0]?.embeddings.values).toHaveLength(4);
    // snake_case on the wire, inside an otherwise camelCase API.
    expect(body.predictions[0]?.embeddings.statistics).toHaveProperty("token_count");
  });

  it("has no :embedContent method, unlike the AI Studio surface", async () => {
    const res = await post(`${MODELS}/${EMBED}:embedContent`, { content: { parts: [{ text: "hi" }] } });
    expect(res.status).toBe(404);
  });

  it("rejects a request with no instances", async () => {
    const res = await post(`${MODELS}/${EMBED}:predict`, {});
    expect(res.status).toBe(400);

    const body = (await res.json()) as { error: { status: string } };
    expect(body.error.status).toBe("INVALID_ARGUMENT");
  });

  it("rejects an out-of-range outputDimensionality", async () => {
    const res = await post(`${MODELS}/${EMBED}:predict`, {
      instances: [{ content: "hi" }],
      parameters: { outputDimensionality: 99999 },
    });
    expect(res.status).toBe(400);
  });
});

describe("gemini-enterprise countTokens", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestServer();
  });
  afterAll(() => stopTestServer(ctx));

  it("counts a prompt through both clients", async () => {
    const [regional, express] = await Promise.all([
      ctx.regional.models.countTokens({ model: "gemini-3.6-flash", contents: "count me please" }),
      ctx.express.models.countTokens({ model: "gemini-3.6-flash", contents: "count me please" }),
    ]);

    expect(regional.totalTokens).toBeGreaterThan(0);
    expect(express.totalTokens).toBe(regional.totalTokens ?? 0);
  });

  it("reports the total only, with no per-modality breakdown", async () => {
    const res = await fetch(`${ctx.baseUrl}${MODELS}/gemini-3.6-flash:countTokens`, {
      method: "POST",
      headers: { "x-goog-api-key": VALID_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "hi" }] }] }),
    });
    const body = (await res.json()) as Record<string, unknown>;

    // AI Studio's equivalent adds promptTokensDetails; this platform does not,
    // and the SDK's Vertex transformer reads no such field.
    expect(Object.keys(body)).toEqual(["totalTokens"]);
  });

  it("grows with the length of the prompt", async () => {
    const [short, long] = await Promise.all([
      ctx.express.models.countTokens({ model: "gemini-3.6-flash", contents: "hi" }),
      ctx.express.models.countTokens({
        model: "gemini-3.6-flash",
        contents: "a substantially longer prompt than the other one",
      }),
    ]);

    expect(long.totalTokens).toBeGreaterThan(short.totalTokens ?? 0);
  });
});
