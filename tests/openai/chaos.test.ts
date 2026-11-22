import type { ServerResponse } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { APIConnectionTimeoutError, InternalServerError, RateLimitError } from "openai";
import { MAX_DELAY_MS } from "../../src/core/chaos";
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
    const start = performance.now();
    const res = await fetch(`${ctx.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${INVALID_API_KEY}`,
        "Content-Type": "application/json",
        "x-llm-mock-status": "500",
        "x-llm-mock-delay": "5000",
      },
      body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }),
    });

    expect(res.status).toBe(401);
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it("provokes APIConnectionTimeoutError via x-llm-mock-delay header", async () => {
    try {
      await ctx.client.chat.completions.create(
        { model: "gpt-4o", messages: [{ role: "user", content: "Slow request" }] },
        { timeout: 50, headers: { "x-llm-mock-delay": "2000" } },
      );
      throw new Error("expected the request to time out");
    } catch (err) {
      expect(err).toBeInstanceOf(APIConnectionTimeoutError);
    }
  });

  it("provokes APIConnectionTimeoutError on streaming calls before SSE headers are sent", async () => {
    try {
      await ctx.client.chat.completions.create(
        { model: "gpt-4o", messages: [{ role: "user", content: "Slow stream" }], stream: true },
        { timeout: 50, headers: { "x-llm-mock-delay": "2000" } },
      );
      throw new Error("expected streaming to time out");
    } catch (err) {
      expect(err).toBeInstanceOf(APIConnectionTimeoutError);
    }
  });

  it("delays a successful response without altering deterministic output", async () => {
    const body = { model: "gpt-4o", messages: [{ role: "user" as const, content: "Delay test" }] };
    const baseline = await ctx.client.chat.completions.create(body);

    const start = performance.now();
    const delayed = await ctx.client.chat.completions.create(body, {
      timeout: 1000,
      headers: { "x-llm-mock-delay": "60" },
    });
    const elapsed = performance.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(45);
    expect(delayed).toEqual(baseline);
  });

  it("accepts 0 and MAX_DELAY_MS as valid delay boundaries", async () => {
    const immediate = await ctx.client.chat.completions.create(
      { model: "gpt-4o", messages: [{ role: "user", content: "Zero delay" }] },
      { headers: { "x-llm-mock-delay": "0" } },
    );
    expect(immediate.choices[0]?.message.content).toBe("Echo: Zero delay");

    // MAX_DELAY_MS itself is accepted (not 400); a short SDK timeout aborts it promptly.
    try {
      await ctx.client.chat.completions.create(
        { model: "gpt-4o", messages: [{ role: "user", content: "Max delay" }] },
        { timeout: 50, headers: { "x-llm-mock-delay": String(MAX_DELAY_MS) } },
      );
      throw new Error("expected the request to time out");
    } catch (err) {
      expect(err).toBeInstanceOf(APIConnectionTimeoutError);
    }
  });

  it("combines x-llm-mock-delay and x-llm-mock-status on the same request", async () => {
    const start = performance.now();
    try {
      await ctx.client.chat.completions.create(
        { model: "gpt-4o", messages: [{ role: "user", content: "Slow 503" }] },
        { headers: { "x-llm-mock-delay": "60", "x-llm-mock-status": "503" } },
      );
      throw new Error("expected the request to fail");
    } catch (err) {
      expect(performance.now() - start).toBeGreaterThanOrEqual(45);
      expect(err).toBeInstanceOf(InternalServerError);
      expect((err as InternalServerError).status).toBe(503);
    }
  });

  it("rejects delays above MAX_DELAY_MS with 400 invalid_value", async () => {
    const res = await fetch(`${ctx.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${VALID_API_KEY}`,
        "Content-Type": "application/json",
        "x-llm-mock-delay": String(MAX_DELAY_MS + 1),
      },
      body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string; code: string; param: string } };
    expect(body.error.code).toBe("invalid_value");
    expect(body.error.param).toBe("x-llm-mock-delay");
    expect(body.error.message).toContain(String(MAX_DELAY_MS));
  });

  it("rejects negative, fractional, non-numeric and duplicate delay headers with 400 invalid_value", async () => {
    for (const invalid of ["-1", "10.5", "100ms", ""]) {
      const res = await fetch(`${ctx.baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${VALID_API_KEY}`,
          "Content-Type": "application/json",
          "x-llm-mock-delay": invalid,
        },
        body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string; param: string } };
      expect(body.error.code).toBe("invalid_value");
      expect(body.error.param).toBe("x-llm-mock-delay");
    }

    const dup = await fetch(`${ctx.baseURL}/chat/completions`, {
      method: "POST",
      headers: [
        ["Authorization", `Bearer ${VALID_API_KEY}`],
        ["Content-Type", "application/json"],
        ["x-llm-mock-delay", "50"],
        ["x-llm-mock-delay", "50"],
      ],
      body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(dup.status).toBe(400);
    const dupBody = (await dup.json()) as { error: { code: string; param: string } };
    expect(dupBody.error.code).toBe("invalid_value");
    expect(dupBody.error.param).toBe("x-llm-mock-delay");
  });

  it("fails fast without waiting when x-llm-mock-status is invalid alongside a valid delay", async () => {
    const start = performance.now();
    const res = await fetch(`${ctx.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${VALID_API_KEY}`,
        "Content-Type": "application/json",
        "x-llm-mock-delay": "5000",
        "x-llm-mock-status": "200",
      },
      body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }),
    });

    expect(res.status).toBe(400);
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it("reports x-llm-mock-status first when both status and delay headers are invalid", async () => {
    const res = await fetch(`${ctx.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${VALID_API_KEY}`,
        "Content-Type": "application/json",
        "x-llm-mock-status": "200",
        "x-llm-mock-delay": "not-a-number",
      },
      body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; param: string } };
    expect(body.error.code).toBe("invalid_value");
    expect(body.error.param).toBe("x-llm-mock-status");
  });

  it("clears the pending delay timer and skips the handler when a client aborts", async () => {
    let serverRes: ServerResponse | undefined;
    ctx.server.once("request", (_req, res) => {
      serverRes = res;
    });

    try {
      await ctx.client.chat.completions.create(
        { model: "gpt-4o", messages: [{ role: "user", content: "Abort cleanup" }] },
        { timeout: 30, headers: { "x-llm-mock-delay": "80" } },
      );
      throw new Error("expected the request to time out");
    } catch (err) {
      expect(err).toBeInstanceOf(APIConnectionTimeoutError);
    }

    // Wait past the full 80ms server delay window to prove the timer was
    // cancelled on disconnect and never ran the downstream route handler.
    await Bun.sleep(80);
    expect(serverRes).toBeDefined();
    expect(serverRes?.headersSent).toBe(false);
    expect(serverRes?.writableEnded).toBe(false);
  });
});
