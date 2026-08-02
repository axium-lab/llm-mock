import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { headers, startTestServer, stopTestServer, type TestContext } from "./setup";

describe("anthropic models", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestServer();
  });
  afterAll(() => stopTestServer(ctx));

  const get = (path: string) => fetch(`${ctx.baseURL}${path}`, { headers: headers() });

  it("lists the catalog through the SDK", async () => {
    const models = await ctx.client.models.list();
    const ids = models.data.map((model) => model.id);

    expect(ids).toContain("claude-opus-5");
    expect(ids).toContain("claude-haiku-4-5");
  });

  it("retrieves a model with the fields the SDK types", async () => {
    const model = await ctx.client.models.retrieve("claude-opus-5");

    expect(model.type).toBe("model");
    expect(model.display_name).toBe("Claude Opus 5");
    // `max_input_tokens` is the context window; there is no `context_window` field.
    expect(model.max_input_tokens).toBe(1_000_000);
    expect(model.max_tokens).toBe(128_000);
  });

  it("reports capabilities as a nested tree of supported flags", async () => {
    const res = await get("/v1/models/claude-opus-5");
    const body = (await res.json()) as { capabilities: Record<string, never> };

    // The SDK reads this with bracket access rather than typed attributes.
    expect(body.capabilities.thinking).toMatchObject({
      supported: true,
      types: { enabled: { supported: false }, adaptive: { supported: true } },
    });
    expect(body.capabilities.effort).toMatchObject({ max: { supported: true } });
  });

  it("marks the smaller model's narrower capabilities", async () => {
    const res = await get("/v1/models/claude-haiku-4-5");
    const body = (await res.json()) as {
      max_input_tokens: number;
      capabilities: Record<string, never>;
    };

    expect(body.max_input_tokens).toBe(200_000);
    expect(body.capabilities.effort).toMatchObject({ max: { supported: false } });
    expect(body.capabilities.thinking).toMatchObject({ supported: false });
  });

  it("paginates by id cursor, not by page token", async () => {
    const first = (await get("/v1/models?limit=2").then((r) => r.json())) as {
      data: { id: string }[];
      has_more: boolean;
      first_id: string;
      last_id: string;
    };

    expect(first.data).toHaveLength(2);
    expect(first.has_more).toBe(true);
    expect(first.first_id).toBe(first.data[0]!.id);
    expect(first.last_id).toBe(first.data[1]!.id);

    const next = (await get(`/v1/models?limit=2&after_id=${first.last_id}`).then((r) => r.json())) as {
      data: { id: string }[];
    };
    expect(next.data.map((m) => m.id)).not.toEqual(first.data.map((m) => m.id));
  });

  it("supports before_id as well", async () => {
    const body = (await get("/v1/models?before_id=claude-opus-4-8").then((r) => r.json())) as {
      data: { id: string }[];
    };

    expect(body.data.map((model) => model.id)).toEqual(["claude-fable-5", "claude-opus-5"]);
  });

  it("rejects an out-of-range limit", async () => {
    const res = await get("/v1/models?limit=0");
    expect(res.status).toBe(400);

    const body = (await res.json()) as { error: { type: string } };
    expect(body.error.type).toBe("invalid_request_error");
  });

  it("404s an unknown model", async () => {
    const res = await get("/v1/models/claude-nope");
    expect(res.status).toBe(404);

    const body = (await res.json()) as { error: { type: string; message: string } };
    expect(body.error.type).toBe("not_found_error");
    expect(body.error.message).toBe("model: claude-nope");
  });
});
