import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { GoogleGenAI } from "@google/genai";
import { INVALID_API_KEY, startTestServer, stopTestServer, VALID_API_KEY, type TestContext } from "./setup";

interface ErrorBody {
  error: {
    code: number;
    message: string;
    status: string;
    details?: { "@type": string; reason: string; domain: string }[];
  };
}

describe("gemini authentication", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestServer();
  });
  afterAll(() => stopTestServer(ctx));

  it("accepts a key listed in api-keys.json", async () => {
    const models = await ctx.client.models.list();
    expect(models.pageLength).toBeGreaterThan(0);
  });

  it("accepts the key in the x-goog-api-key header", async () => {
    const res = await fetch(`${ctx.baseUrl}/v1beta/models`, {
      headers: { "x-goog-api-key": VALID_API_KEY },
    });
    expect(res.status).toBe(200);
  });

  it("accepts the key in the ?key= query parameter", async () => {
    const res = await fetch(`${ctx.baseUrl}/v1beta/models?key=${VALID_API_KEY}`);
    expect(res.status).toBe(200);
  });

  it("accepts a bearer token, the way OAuth callers authenticate", async () => {
    const res = await fetch(`${ctx.baseUrl}/v1beta/models`, {
      headers: { authorization: `Bearer ${VALID_API_KEY}` },
    });
    expect(res.status).toBe(200);
  });

  it("rejects an unknown key with 400 API_KEY_INVALID", async () => {
    const res = await fetch(`${ctx.baseUrl}/v1beta/models`, {
      headers: { "x-goog-api-key": INVALID_API_KEY },
    });
    expect(res.status).toBe(400);

    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe(400);
    expect(body.error.status).toBe("INVALID_ARGUMENT");
    expect(body.error.message).toBe("API key not valid. Please pass a valid API key.");
    expect(body.error.details?.[0]?.reason).toBe("API_KEY_INVALID");
  });

  it("rejects a request with no credential at all with 403 PERMISSION_DENIED", async () => {
    const res = await fetch(`${ctx.baseUrl}/v1beta/models`);
    expect(res.status).toBe(403);

    const body = (await res.json()) as ErrorBody;
    expect(body.error.status).toBe("PERMISSION_DENIED");
    expect(body.error.message).toContain("unregistered callers");
  });

  it("surfaces the rejection through the SDK", async () => {
    const client = new GoogleGenAI({
      apiKey: INVALID_API_KEY,
      httpOptions: { baseUrl: ctx.baseUrl },
    });
    await expect(client.models.list()).rejects.toThrow(/API key not valid/);
  });
});
