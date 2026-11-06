import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import AnthropicFoundry from "@anthropic-ai/foundry-sdk";
import createClient, { isUnexpected } from "@azure-rest/ai-inference";
import { AzureKeyCredential } from "@azure/core-auth";
import { InternalServerError, RateLimitError } from "openai";
import { API_VERSION, INVALID_API_KEY, startTestServer, stopTestServer, VALID_API_KEY, type TestContext } from "./setup";

interface AzureOpenAIErrorBody {
  error: { code: string; message: string };
}

interface AnthropicErrorBody {
  type: "error";
  error: { type: string; message: string };
}

interface ModelInferenceErrorBody {
  status: number;
  code: string;
  message: string;
}

describe("azure chaos fault injection", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestServer();
  });
  afterAll(() => stopTestServer(ctx));

  describe("azure openai", () => {
    it("provokes 500 error through the AzureOpenAI SDK client", async () => {
      try {
        await ctx.classic.models.list({ headers: { "x-llm-mock-status": "500" }, maxRetries: 0 });
        throw new Error("expected failure");
      } catch (err) {
        expect(err).toBeInstanceOf(InternalServerError);
        const serverErr = err as InternalServerError;
        expect(serverErr.status).toBe(500);
      }
    });

    it("provokes 429 error through the AzureOpenAI SDK client with retry-after header", async () => {
      try {
        await ctx.classic.models.list({ headers: { "x-llm-mock-status": "429" }, maxRetries: 0 });
        throw new Error("expected failure");
      } catch (err) {
        expect(err).toBeInstanceOf(RateLimitError);
        const rateLimitErr = err as RateLimitError;
        expect(rateLimitErr.status).toBe(429);
        expect(rateLimitErr.headers?.get("retry-after")).toBe("1");
      }
    });

    it("provokes 500 on v1 surface through plain OpenAI SDK client", async () => {
      try {
        await ctx.v1.chat.completions.create(
          { model: "gpt-4o", messages: [{ role: "user", content: "hi" }] },
          { headers: { "x-llm-mock-status": "500" } },
        );
        throw new Error("expected failure");
      } catch (err) {
        expect(err).toBeInstanceOf(InternalServerError);
        const serverErr = err as InternalServerError;
        expect(serverErr.status).toBe(500);
      }
    });

    it("requires api-version before evaluating chaos on classic surface", async () => {
      const res = await fetch(`${ctx.baseUrl}/models`, {
        headers: { "api-key": VALID_API_KEY, "x-llm-mock-status": "500" },
      });
      expect(res.status).toBe(400);

      const body = (await res.json()) as AzureOpenAIErrorBody;
      expect(body.error.code).toBe("MissingApiVersionParameter");
    });

    it("evaluates gateway auth before chaos", async () => {
      const res = await fetch(`${ctx.baseUrl}/models?api-version=${API_VERSION}`, {
        headers: { "api-key": INVALID_API_KEY, "x-llm-mock-status": "500" },
      });
      expect(res.status).toBe(401);
    });
  });

  describe("azure foundry anthropic", () => {
    it("provokes 529 overloaded_error through the AnthropicFoundry SDK client", async () => {
      try {
        await ctx.claude.messages.create(
          {
            model: "claude-opus-5",
            max_tokens: 1024,
            messages: [{ role: "user", content: "Trigger 529" }],
          },
          { headers: { "x-llm-mock-status": "529" } },
        );
        throw new Error("expected failure");
      } catch (err) {
        expect(err).toBeInstanceOf(AnthropicFoundry.InternalServerError);
        const serverErr = err as { status: number; error?: { error?: { type?: string } } };
        expect(serverErr.status).toBe(529);
        expect(serverErr.error?.error?.type).toBe("overloaded_error");
      }
    });

    it("provokes 500 error in anthropic wire format", async () => {
      const res = await fetch(`${ctx.origin}/azure/anthropic/v1/messages`, {
        method: "POST",
        headers: {
          "api-key": VALID_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
          "x-llm-mock-status": "500",
        },
        body: JSON.stringify({
          model: "claude-opus-5",
          max_tokens: 1024,
          messages: [{ role: "user", content: "Hello" }],
        }),
      });
      expect(res.status).toBe(500);

      const body = (await res.json()) as AnthropicErrorBody;
      expect(body.type).toBe("error");
      expect(body.error.type).toBe("api_error");
    });

    it("requires anthropic-version before evaluating chaos", async () => {
      const res = await fetch(`${ctx.origin}/azure/anthropic/v1/messages`, {
        method: "POST",
        headers: {
          "api-key": VALID_API_KEY,
          "content-type": "application/json",
          "x-llm-mock-status": "500",
        },
        body: JSON.stringify({
          model: "claude-opus-5",
          max_tokens: 1024,
          messages: [{ role: "user", content: "Hello" }],
        }),
      });
      expect(res.status).toBe(400);

      const body = (await res.json()) as AnthropicErrorBody;
      expect(body.type).toBe("error");
      expect(body.error.type).toBe("invalid_request_error");
    });
  });

  describe("azure model inference", () => {
    it("surfaces 500 error through the @azure-rest/ai-inference SDK client", async () => {
      const client = createClient(`${ctx.origin}/azure/models`, new AzureKeyCredential(VALID_API_KEY), {
        allowInsecureConnection: true,
        retryOptions: { maxRetries: 0 },
      });
      const res = await client.path("/chat/completions").post({
        body: { model: "Phi-4", messages: [{ role: "user", content: "Hello" }] },
        headers: { "x-llm-mock-status": "500" },
      });
      expect(isUnexpected(res)).toBe(true);
      expect(res.status).toBe("500");
    });

    it("provokes 500 error in model inference flat format", async () => {
      const res = await fetch(`${ctx.origin}/azure/models/chat/completions?api-version=2024-05-01-preview`, {
        method: "POST",
        headers: {
          "api-key": VALID_API_KEY,
          "content-type": "application/json",
          "x-llm-mock-status": "500",
        },
        body: JSON.stringify({
          model: "Phi-4",
          messages: [{ role: "user", content: "Hello" }],
        }),
      });
      expect(res.status).toBe(500);

      const body = (await res.json()) as ModelInferenceErrorBody;
      expect(body.status).toBe(500);
      expect(body.code).toBe("500");
    });

    it("requires api-version before evaluating chaos", async () => {
      const res = await fetch(`${ctx.origin}/azure/models/chat/completions`, {
        method: "POST",
        headers: {
          "api-key": VALID_API_KEY,
          "content-type": "application/json",
          "x-llm-mock-status": "500",
        },
        body: JSON.stringify({
          model: "Phi-4",
          messages: [{ role: "user", content: "Hello" }],
        }),
      });
      expect(res.status).toBe(400);

      const body = (await res.json()) as ModelInferenceErrorBody;
      expect(body.code).toBe("MissingApiVersionParameter");
    });
  });
});
