import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import OpenAI, { AuthenticationError } from "openai";
import { INVALID_API_KEY, startTestServer, stopTestServer, type TestContext } from "./setup";

describe("authentication", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestServer();
  });
  afterAll(() => stopTestServer(ctx));

  it("accepts a key listed in api-keys.json", async () => {
    const models = await ctx.client.models.list();
    expect(models.data.length).toBeGreaterThan(0);
  });

  it("rejects a key not listed in api-keys.json with invalid_api_key", async () => {
    const client = new OpenAI({ apiKey: INVALID_API_KEY, baseURL: ctx.baseURL, maxRetries: 0 });
    try {
      await client.models.list();
      throw new Error("expected the request to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(AuthenticationError);
      const authError = error as AuthenticationError;
      expect(authError.status).toBe(401);
      expect(authError.code).toBe("invalid_api_key");
    }
  });

  it("rejects a request without Authorization header", async () => {
    const res = await fetch(`${ctx.baseURL}/models`);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { message: string; type: string } };
    expect(body.error.type).toBe("invalid_request_error");
    expect(body.error.message).toContain("API key");
  });
});
