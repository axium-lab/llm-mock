import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { InternalServerError, RateLimitError } from "openai";
import { INVALID_API_KEY, startTestServer, stopTestServer, VALID_API_KEY, type TestContext } from "./setup";

describe("openai chaos fault injection", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestServer();
  });
  afterAll(() => stopTestServer(ctx));

  it("provokes 500 InternalServerError via x-llm-mock-status header", async () => {
    try {
      await ctx.client.chat.completions.create(
        { model: "gpt-4o", messages: [{ role: "user", content: "Trigger 500" }] },
        { headers: { "x-llm-mock-status": "500" } },
      );
      throw new Error("expected the request to fail");
    } catch (err) {
      expect(err).toBeInstanceOf(InternalServerError);
      const serverErr = err as InternalServerError;
      expect(serverErr.status).toBe(500);
      expect(serverErr.message).toContain("error while processing your request");
    }
  });

  it("provokes 429 RateLimitError via x-llm-mock-status header", async () => {
    try {
      await ctx.client.chat.completions.create(
        { model: "gpt-4o", messages: [{ role: "user", content: "Trigger 429" }] },
        { headers: { "x-llm-mock-status": "429" } },
      );
      throw new Error("expected the request to fail");
    } catch (err) {
      expect(err).toBeInstanceOf(RateLimitError);
      const rateLimitErr = err as RateLimitError;
      expect(rateLimitErr.status).toBe(429);
      expect(rateLimitErr.type).toBe("rate_limit_error");
      expect(rateLimitErr.code).toBe("rate_limit_exceeded");
      expect(rateLimitErr.headers?.get("retry-after")).toBe("1");
    }
  });

  it("rejects streaming calls before SSE headers are sent", async () => {
    try {
      await ctx.client.chat.completions.create(
        { model: "gpt-4o", messages: [{ role: "user", content: "stream error" }], stream: true },
        { headers: { "x-llm-mock-status": "500" } },
      );
      throw new Error("expected streaming to fail");
    } catch (err) {
      expect(err).toBeInstanceOf(InternalServerError);
      const serverErr = err as InternalServerError;
      expect(serverErr.status).toBe(500);
    }
  });

  it("rejects an invalid status code outside 400-599 with 400 invalid_value", async () => {
    const res = await fetch(`${ctx.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${VALID_API_KEY}`,
        "Content-Type": "application/json",
        "x-llm-mock-status": "200", // 200 is not a fault status
      },
      body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string; code: string } };
    expect(body.error.code).toBe("invalid_value");
    expect(body.error.message).toContain("between 400 and 599");
  });

  it("rejects non-numeric status codes with 400 invalid_value", async () => {
    const res = await fetch(`${ctx.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${VALID_API_KEY}`,
        "Content-Type": "application/json",
        "x-llm-mock-status": "500abc",
      },
      body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string; code: string } };
    expect(body.error.code).toBe("invalid_value");
    expect(body.error.message).toContain("between 400 and 599");
  });

  it("rejects duplicate or multiple status headers with 400 invalid_value", async () => {
    const res = await fetch(`${ctx.baseURL}/chat/completions`, {
      method: "POST",
      headers: [
        ["Authorization", `Bearer ${VALID_API_KEY}`],
        ["Content-Type", "application/json"],
        ["x-llm-mock-status", "500"],
        ["x-llm-mock-status", "500"],
      ],
      body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string; code: string } };
    expect(body.error.code).toBe("invalid_value");
    expect(body.error.message).toContain("between 400 and 599");
  });

  it("evaluates auth before chaos", async () => {
    const res = await fetch(`${ctx.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${INVALID_API_KEY}`,
        "Content-Type": "application/json",
        "x-llm-mock-status": "500",
      },
      body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }),
    });

    expect(res.status).toBe(401);
  });
});
