import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { GoogleGenAI } from "@google/genai";
import { INVALID_API_KEY, LOCATION, PROJECT, startTestServer, stopTestServer, VALID_API_KEY, type TestContext } from "./setup";

interface ClassicErrorBody {
  error: { code: number; message: string; status: string };
}

interface NextGenErrorBody {
  error: { code: string; message: string };
}

describe("gemini-enterprise chaos fault injection", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestServer();
  });
  afterAll(() => stopTestServer(ctx));

  const expressPath = "/v1beta1/publishers/google/models";
  const regionalPath = `/v1beta1/projects/${PROJECT}/locations/${LOCATION}/publishers/google/models`;

  describe("express mode", () => {
    it("provokes 500 INTERNAL error through the GoogleGenAI vertexai SDK client", async () => {
      const client = new GoogleGenAI({
        vertexai: true,
        apiKey: VALID_API_KEY,
        httpOptions: { baseUrl: ctx.baseUrl, headers: { "x-llm-mock-status": "500" } },
      });
      await expect(client.models.generateContent({ model: "gemini-3.6-flash", contents: "hi" })).rejects.toThrow(/500/);
    });

    it("provokes 500 INTERNAL error via x-llm-mock-status header", async () => {
      const res = await fetch(`${ctx.baseUrl}${expressPath}`, {
        headers: { "x-goog-api-key": VALID_API_KEY, "x-llm-mock-status": "500" },
      });
      expect(res.status).toBe(500);

      const body = (await res.json()) as ClassicErrorBody;
      expect(body.error.code).toBe(500);
      expect(body.error.status).toBe("INTERNAL");
    });

    it("provokes 429 RESOURCE_EXHAUSTED error with retry-after header", async () => {
      const res = await fetch(`${ctx.baseUrl}${expressPath}`, {
        headers: { "x-goog-api-key": VALID_API_KEY, "x-llm-mock-status": "429" },
      });
      expect(res.status).toBe(429);
      expect(res.headers.get("retry-after")).toBe("1");

      const body = (await res.json()) as ClassicErrorBody;
      expect(body.error.code).toBe(429);
      expect(body.error.status).toBe("RESOURCE_EXHAUSTED");
    });
  });

  describe("regional mode", () => {
    it("provokes 500 INTERNAL error on regional path", async () => {
      const res = await fetch(`${ctx.baseUrl}${regionalPath}`, {
        headers: { authorization: `Bearer ${VALID_API_KEY}`, "x-llm-mock-status": "500" },
      });
      expect(res.status).toBe(500);

      const body = (await res.json()) as ClassicErrorBody;
      expect(body.error.code).toBe(500);
      expect(body.error.status).toBe("INTERNAL");
    });
  });

  describe("interactions next-gen surface", () => {
    it("provokes 500 in next-gen envelope on interactions", async () => {
      const scope = `v1beta1/projects/${PROJECT}/locations/${LOCATION}`;
      const res = await fetch(`${ctx.baseUrl}/${encodeURIComponent(scope)}/interactions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${VALID_API_KEY}`,
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
  });

  describe("precedence", () => {
    it("evaluates auth before chaos", async () => {
      const res = await fetch(`${ctx.baseUrl}${expressPath}`, {
        headers: { "x-goog-api-key": INVALID_API_KEY, "x-llm-mock-status": "500" },
      });
      expect(res.status).toBe(400);

      const body = (await res.json()) as { error: { details?: { reason: string }[] } };
      expect(body.error.details?.[0]?.reason).toBe("API_KEY_INVALID");
    });
  });
});
