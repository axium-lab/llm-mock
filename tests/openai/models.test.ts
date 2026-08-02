import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { NotFoundError } from "openai";
import { startTestServer, stopTestServer, type TestContext } from "./setup";

describe("models", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestServer();
  });
  afterAll(() => stopTestServer(ctx));

  it("lists the simulated catalog", async () => {
    const models = await ctx.client.models.list();
    const ids = models.data.map((model) => model.id);
    expect(ids).toContain("gpt-4o");
    expect(ids).toContain("text-embedding-3-small");
    expect(models.data[0]?.object).toBe("model");
  });

  it("retrieves a single model", async () => {
    const model = await ctx.client.models.retrieve("gpt-4o");
    expect(model.id).toBe("gpt-4o");
    expect(model.owned_by).toBe("openai");
  });

  it("returns 404 in OpenAI format for an unknown model", async () => {
    try {
      await ctx.client.models.retrieve("gpt-unknown");
      throw new Error("expected the request to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundError);
      expect((error as NotFoundError).code).toBe("model_not_found");
    }
  });
});
