import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { FixtureRule } from "../src/core/fixtures";
import {
  clearFixtures,
  registerFixture,
  startTestServer,
  stopTestServer,
  VALID_API_KEY,
  type TestContext,
} from "./setup";

interface ErrorBody {
  error: { message: string; type: string; code: string | null };
}

interface FixturesBody {
  fixtures: FixtureRule[];
}

describe("provider routing", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestServer();
  });
  afterAll(() => stopTestServer(ctx));

  test("the bare /v1 prefix no longer exists", async () => {
    const origin = ctx.baseURL.replace("/openai/v1", "");
    const res = await fetch(`${origin}/v1/models`, {
      headers: { Authorization: `Bearer ${VALID_API_KEY}` },
    });
    expect(res.status).toBe(404);
  });

  test("unknown URLs under /openai use the OpenAI error envelope", async () => {
    const res = await fetch(`${ctx.baseURL}/nope`, {
      headers: { Authorization: `Bearer ${VALID_API_KEY}` },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.type).toBe("invalid_request_error");
    expect(body.error.code).toBe("unknown_url");
    expect(body.error.message).toContain("/openai/v1/nope");
  });
});

describe("fixtures admin API", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestServer();
  });
  afterAll(() => stopTestServer(ctx));
  afterEach(() => clearFixtures(ctx));

  test("GET /__mock/fixtures lists registered rules", async () => {
    await registerFixture(ctx, { match: { contains: "weather" }, response: { content: "Sunny." } });
    const res = await fetch(`${ctx.mockURL}/fixtures`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as FixturesBody;
    expect(body.fixtures).toHaveLength(1);
    expect(body.fixtures[0]!.match?.contains).toBe("weather");
  });

  test("a fixture scoped to the matching provider applies", async () => {
    await registerFixture(ctx, { match: { provider: "openai" }, response: { content: "OpenAI only." } });
    const completion = await ctx.client.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(completion.choices[0]!.message.content).toBe("OpenAI only.");
  });

  test("a fixture scoped to another provider does not apply", async () => {
    await registerFixture(ctx, { match: { provider: "anthropic" }, response: { content: "Claude only." } });
    const completion = await ctx.client.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(completion.choices[0]!.message.content).toBe("Echo: hi");
  });

  test("DELETE /__mock/fixtures?provider= clears only that provider's rules", async () => {
    await registerFixture(ctx, { match: { provider: "anthropic" }, response: { content: "a" } });
    await registerFixture(ctx, { match: { provider: "openai" }, response: { content: "b" } });

    const res = await fetch(`${ctx.mockURL}/fixtures?provider=anthropic`, { method: "DELETE" });
    expect(((await res.json()) as { cleared: number }).cleared).toBe(1);

    const remaining = (await (await fetch(`${ctx.mockURL}/fixtures`)).json()) as FixturesBody;
    expect(remaining.fixtures).toHaveLength(1);
    expect(remaining.fixtures[0]!.match?.provider).toBe("openai");
  });

  test("two servers in the same process do not share fixtures", async () => {
    const other = await startTestServer();
    try {
      await registerFixture(ctx, { response: { content: "Only on the first server." } });
      const completion = await other.client.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: "hi" }],
      });
      expect(completion.choices[0]!.message.content).toBe("Echo: hi");
    } finally {
      await stopTestServer(other);
    }
  });
});
