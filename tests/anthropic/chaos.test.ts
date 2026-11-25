import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import Anthropic, { APIError } from "@anthropic-ai/sdk";
import { headers, startTestServer, stopTestServer, VALID_API_KEY, type TestContext } from "./setup";

describe("anthropic chaos fault injection", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestServer();
  });
  afterAll(() => stopTestServer(ctx));

  it("provokes 529 overloaded_error via x-llm-mock-status header", async () => {
    try {
      await ctx.client.messages.create(
        {
          model: "claude-3-5-sonnet-20241022",
          max_tokens: 100,
          messages: [{ role: "user", content: "Trigger 529" }],
        },
        { headers: { "x-llm-mock-status": "529" } },
      );
      throw new Error("expected the request to fail");
    } catch (err) {
      expect(err).toBeInstanceOf(Anthropic.InternalServerError);
      const apiErr = err as APIError;
      expect(apiErr.status).toBe(529);
      expect((apiErr.error as { error?: { type?: string } })?.error?.type).toBe("overloaded_error");
    }
  });

  it("provokes 429 rate_limit_error via x-llm-mock-status header", async () => {
    try {
      await ctx.client.messages.create(
        {
          model: "claude-3-5-sonnet-20241022",
          max_tokens: 100,
          messages: [{ role: "user", content: "Trigger 429" }],
        },
        { headers: { "x-llm-mock-status": "429" } },
      );
      throw new Error("expected the request to fail");
    } catch (err) {
      expect(err).toBeInstanceOf(Anthropic.RateLimitError);
      const rateErr = err as APIError;
      expect(rateErr.status).toBe(429);
      expect((rateErr.error as { error?: { type?: string } })?.error?.type).toBe("rate_limit_error");
      expect(rateErr.headers?.get("retry-after")).toBe("1");
    }
  });

  it("rejects streaming messages calls before stream opens", async () => {
    try {
      const stream = ctx.client.messages.stream(
        {
          model: "claude-3-5-sonnet-20241022",
          max_tokens: 100,
          messages: [{ role: "user", content: "stream error" }],
        },
        { headers: { "x-llm-mock-status": "500" } },
      );
      await stream.done();
      throw new Error("expected streaming to fail");
    } catch (err) {
      expect(err).toBeInstanceOf(Anthropic.InternalServerError);
      const serverErr = err as APIError;
      expect(serverErr.status).toBe(500);
    }
  });

  it("checks version header before evaluating chaos", async () => {
    const start = performance.now();
    const res = await fetch(`${ctx.baseURL}/v1/messages`, {
      method: "POST",
      headers: {
        "x-api-key": VALID_API_KEY,
        "content-type": "application/json",
        "x-llm-mock-status": "500",
        "x-llm-mock-delay": "5000",
      },
      body: JSON.stringify({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 100,
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    expect(res.status).toBe(400);
    expect(performance.now() - start).toBeLessThan(1000);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("anthropic-version header is required");
  });

  it("provokes APIConnectionTimeoutError via x-llm-mock-delay header", async () => {
    try {
      await ctx.client.messages.create(
        {
          model: "claude-3-5-sonnet-20241022",
          max_tokens: 100,
          messages: [{ role: "user", content: "Slow request" }],
        },
        { timeout: 50, headers: { "x-llm-mock-delay": "2000" } },
      );
      throw new Error("expected the request to time out");
    } catch (err) {
      expect(err).toBeInstanceOf(Anthropic.APIConnectionTimeoutError);
    }
  });

  it("provokes APIConnectionTimeoutError on streaming calls before stream opens", async () => {
    try {
      const stream = ctx.client.messages.stream(
        {
          model: "claude-3-5-sonnet-20241022",
          max_tokens: 100,
          messages: [{ role: "user", content: "Slow stream" }],
        },
        { timeout: 50, headers: { "x-llm-mock-delay": "2000" } },
      );
      await stream.done();
      throw new Error("expected streaming to time out");
    } catch (err) {
      expect(err).toBeInstanceOf(Anthropic.APIConnectionTimeoutError);
    }
  });

  it("provokes 500 api_error via x-llm-mock-status header", async () => {
    const res = await fetch(`${ctx.baseURL}/v1/messages`, {
      method: "POST",
      headers: { ...headers(), "content-type": "application/json", "x-llm-mock-status": "500" },
      body: JSON.stringify({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 100,
        messages: [{ role: "user", content: "Trigger 500" }],
      }),
    });

    expect(res.status).toBe(500);
    const body = (await res.json()) as { type: string; error: { type: string; message: string } };
    expect(body.type).toBe("error");
    expect(body.error.type).toBe("api_error");
  });
});
