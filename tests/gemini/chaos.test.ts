import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { GoogleGenAI } from "@google/genai";
import { INVALID_API_KEY, startTestServer, stopTestServer, VALID_API_KEY, type TestContext } from "./setup";

interface ClassicErrorBody {
  error: { code: number; message: string; status: string };
}

interface NextGenErrorBody {
  error: { code: string; message: string };
}

describe("gemini chaos fault injection", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestServer();
  });
  afterAll(() => stopTestServer(ctx));

  it("provokes 500 INTERNAL error via SDK client", async () => {
    const client = new GoogleGenAI({
      apiKey: VALID_API_KEY,
      httpOptions: { baseUrl: ctx.baseUrl, headers: { "x-llm-mock-status": "500" } },
    });
    await expect(client.models.generateContent({ model: "gemini-3.6-flash", contents: "hi" })).rejects.toThrow(
      /500/,
    );
  });

  it("provokes 429 RESOURCE_EXHAUSTED error via SDK client", async () => {
    const client = new GoogleGenAI({
      apiKey: VALID_API_KEY,
      httpOptions: { baseUrl: ctx.baseUrl, headers: { "x-llm-mock-status": "429" } },
    });
    await expect(client.models.generateContent({ model: "gemini-3.6-flash", contents: "hi" })).rejects.toThrow(
      /429/,
    );
  });

  it("provokes 500 INTERNAL error in classic google.rpc.Status envelope", async () => {
    const res = await fetch(`${ctx.baseUrl}/v1beta/models`, {
      headers: { "x-goog-api-key": VALID_API_KEY, "x-llm-mock-status": "500" },
    });
    expect(res.status).toBe(500);

    const body = (await res.json()) as ClassicErrorBody;
    expect(body.error.code).toBe(500);
    expect(body.error.status).toBe("INTERNAL");
  });

  it("provokes 429 RESOURCE_EXHAUSTED error with retry-after header", async () => {
    const res = await fetch(`${ctx.baseUrl}/v1beta/models`, {
      headers: { "x-goog-api-key": VALID_API_KEY, "x-llm-mock-status": "429" },
    });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("1");

    const body = (await res.json()) as ClassicErrorBody;
    expect(body.error.code).toBe(429);
    expect(body.error.status).toBe("RESOURCE_EXHAUSTED");
  });

  it("provokes 500 in next-gen envelope on /interactions", async () => {
    const res = await fetch(`${ctx.baseUrl}/v1beta/interactions`, {
      method: "POST",
      headers: {
        "x-goog-api-key": VALID_API_KEY,
        "content-type": "application/json",
        "x-llm-mock-status": "500",
      },
      body: JSON.stringify({ model: "gemini-3.6-flash", input: "hi" }),
    });
    expect(res.status).toBe(500);

    const body = (await res.json()) as NextGenErrorBody;
    expect(body.error.code).toBe("api_error");
    expect(body.error.message).toContain("error while processing your request");
  });

  it("provokes 500 on file upload endpoint", async () => {
    const res = await fetch(`${ctx.baseUrl}/upload/v1beta/files`, {
      method: "POST",
      headers: {
        "x-goog-api-key": VALID_API_KEY,
        "content-type": "application/json",
        "x-goog-upload-command": "start",
        "x-llm-mock-status": "500",
      },
      body: JSON.stringify({ file: { display_name: "test.txt" } }),
    });
    expect(res.status).toBe(500);

    const body = (await res.json()) as ClassicErrorBody;
    expect(body.error.code).toBe(500);
    expect(body.error.status).toBe("INTERNAL");
  });

  it("provokes 500 on openai compatibility endpoint", async () => {
    const res = await fetch(`${ctx.baseUrl}/v1beta/openai/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${VALID_API_KEY}`,
        "content-type": "application/json",
        "x-llm-mock-status": "500",
      },
      body: JSON.stringify({ model: "gemini-3.6-flash", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(500);

    const body = (await res.json()) as ClassicErrorBody;
    expect(body.error.code).toBe(500);
    expect(body.error.status).toBe("INTERNAL");
  });

  it("evaluates auth before chaos", async () => {
    const res = await fetch(`${ctx.baseUrl}/v1beta/models`, {
      headers: { "x-goog-api-key": INVALID_API_KEY, "x-llm-mock-status": "500" },
    });
    expect(res.status).toBe(400);

    const body = (await res.json()) as { error: { details?: { reason: string }[] } };
    expect(body.error.details?.[0]?.reason).toBe("API_KEY_INVALID");
  });
});

