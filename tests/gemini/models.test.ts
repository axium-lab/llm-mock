import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { startTestServer, stopTestServer, VALID_API_KEY, type TestContext } from "./setup";

interface ErrorBody {
  error: { code: number; message: string; status: string; details?: { reason: string }[] };
}

describe("gemini models", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestServer();
  });
  afterAll(() => stopTestServer(ctx));

  it("lists the simulated catalog through the SDK", async () => {
    const pager = await ctx.client.models.list();
    const names: (string | undefined)[] = [];
    for await (const model of pager) names.push(model.name);

    expect(names).toContain("models/gemini-3.6-flash");
    expect(names).toContain("models/gemini-embedding-001");
  });

  it("retrieves a single model with its wire fields mapped", async () => {
    const model = await ctx.client.models.get({ model: "gemini-3.6-flash" });

    expect(model.name).toBe("models/gemini-3.6-flash");
    expect(model.displayName).toBe("Gemini 3.6 Flash");
    expect(model.inputTokenLimit).toBe(1_048_576);
    // The SDK renames the wire's supportedGenerationMethods to supportedActions.
    expect(model.supportedActions).toContain("generateContent");
  });

  it("nests the collection under `models`, not OpenAI's list envelope", async () => {
    const res = await fetch(`${ctx.baseUrl}/v1beta/models`, {
      headers: { "x-goog-api-key": VALID_API_KEY },
    });
    const body = (await res.json()) as { models: { name: string }[] };

    expect(Array.isArray(body.models)).toBe(true);
    expect(body.models[0]?.name).toStartWith("models/");
  });

  it("serves tuned models as an empty collection", async () => {
    const res = await fetch(`${ctx.baseUrl}/v1beta/tunedModels`, {
      headers: { "x-goog-api-key": VALID_API_KEY },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tunedModels: [] });
  });

  it("returns a Google-shaped 404 for an unknown model", async () => {
    const res = await fetch(`${ctx.baseUrl}/v1beta/models/gemini-unknown`, {
      headers: { "x-goog-api-key": VALID_API_KEY },
    });
    expect(res.status).toBe(404);

    const body = (await res.json()) as ErrorBody;
    expect(body.error.status).toBe("NOT_FOUND");
    expect(body.error.message).toContain("models/gemini-unknown is not found for API version v1beta");
    expect(body.error.details?.[0]?.reason).toBe("MODEL_NOT_FOUND");
  });

  it("serves the same catalog on v1 and v1beta", async () => {
    const headers = { "x-goog-api-key": VALID_API_KEY };
    const [beta, stable] = await Promise.all([
      fetch(`${ctx.baseUrl}/v1beta/models`, { headers }).then((res) => res.json()),
      fetch(`${ctx.baseUrl}/v1/models`, { headers }).then((res) => res.json()),
    ]);
    expect(stable).toEqual(beta);
  });
});
