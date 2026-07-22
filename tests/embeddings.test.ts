import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { startTestServer, stopTestServer, type TestContext } from "./setup";

describe("embeddings", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestServer();
  });
  afterAll(() => stopTestServer(ctx));

  it("returns a unit vector with the model's dimension", async () => {
    const result = await ctx.client.embeddings.create({
      model: "text-embedding-3-small",
      input: "hello world",
    });
    const vector = result.data[0]?.embedding as number[];
    expect(vector).toHaveLength(1536);
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    expect(norm).toBeCloseTo(1, 3);
    expect(result.usage.prompt_tokens).toBeGreaterThan(0);
  });

  it("is deterministic: same input produces the same vector", async () => {
    const request = { model: "text-embedding-3-small", input: "deterministic" };
    const first = await ctx.client.embeddings.create(request);
    const second = await ctx.client.embeddings.create(request);
    expect(second.data[0]?.embedding).toEqual(first.data[0]?.embedding!);
  });

  it("honors the dimensions parameter", async () => {
    const result = await ctx.client.embeddings.create({
      model: "text-embedding-3-small",
      input: "short vector",
      dimensions: 256,
    });
    expect(result.data[0]?.embedding).toHaveLength(256);
  });

  it("indexes multiple inputs", async () => {
    const result = await ctx.client.embeddings.create({
      model: "text-embedding-3-large",
      input: ["first", "second"],
    });
    expect(result.data).toHaveLength(2);
    expect(result.data.map((item) => item.index)).toEqual([0, 1]);
    expect(result.data[0]?.embedding).toHaveLength(3072);
  });
});
