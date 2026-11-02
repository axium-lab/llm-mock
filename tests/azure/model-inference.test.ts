import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import createClient, { isUnexpected, type ModelClient } from "@azure-rest/ai-inference";
import { AzureKeyCredential } from "@azure/core-auth";
import { createSseStream } from "@azure/core-sse";
import { INVALID_API_KEY, startTestServer, stopTestServer, VALID_API_KEY, type TestContext } from "./setup";

const API_VERSION = "2024-05-01-preview";

interface FlatError {
  status: number;
  code: string;
  message: string;
  param?: string;
  type?: null;
  detail?: { loc: string[]; input: unknown };
}

// The Azure AI Model Inference API at /azure/models: the route for Foundry's
// non-OpenAI models, with its own SDK, its own flat error envelope and the
// `extra-parameters` header.
describe("azure model inference API", () => {
  let ctx: TestContext;
  let client: ModelClient;
  beforeAll(async () => {
    ctx = await startTestServer();
    client = createClient(`${ctx.origin}/azure/models`, new AzureKeyCredential(VALID_API_KEY), {
      allowInsecureConnection: true,
      retryOptions: { maxRetries: 0 },
    });
  });
  afterAll(() => stopTestServer(ctx));

  // `null` sends the request without any api-version at all.
  const raw = (path: string, init: RequestInit = {}, version: string | null = API_VERSION) =>
    fetch(`${ctx.origin}/azure/models${path}${version === null ? "" : `?api-version=${version}`}`, {
      ...init,
      headers: { "api-key": VALID_API_KEY, "content-type": "application/json", ...init.headers },
    });

  const hello = { messages: [{ role: "user", content: "Hello!" }] };

  it("answers chat completions through the SDK", async () => {
    const res = await client.path("/chat/completions").post({ body: { ...hello, model: "Mistral-large" } });
    if (isUnexpected(res)) throw new Error(JSON.stringify(res.body));

    expect(res.body.model).toBe("Mistral-large");
    expect(res.body.choices[0]?.message.role).toBe("assistant");
    expect(res.body.choices[0]?.message.content).toBe("Echo: Hello!");
    expect(res.body.choices[0]?.finish_reason).toBe("stop");
    expect(res.body.usage.total_tokens).toBeGreaterThan(0);
  });

  it("needs no model on a single-model endpoint, and names the one deployed", async () => {
    const res = await client.path("/chat/completions").post({ body: hello });
    if (isUnexpected(res)) throw new Error(JSON.stringify(res.body));

    expect(res.body.model).toBe("Phi-4");
  });

  it("describes the deployed model", async () => {
    const res = await client.path("/info").get();
    if (isUnexpected(res)) throw new Error(JSON.stringify(res.body));

    expect(res.body).toEqual({ model_name: "Phi-4", model_type: "chat_completion", model_provider_name: "Microsoft" });
  });

  it("streams with the [DONE] sentinel", async () => {
    const res = await client
      .path("/chat/completions")
      .post({ body: { ...hello, stream: true } })
      .asNodeStream();
    expect(res.status).toBe("200");

    let text = "";
    for await (const event of createSseStream(res.body!)) {
      if (event.data === "[DONE]") break;
      const chunk = JSON.parse(event.data) as { choices: { delta: { content?: string } }[] };
      text += chunk.choices[0]?.delta.content ?? "";
    }
    expect(text).toBe("Echo: Hello!");
  });

  it("embeds", async () => {
    const res = await client.path("/embeddings").post({ body: { input: ["hello", "world", "hello"] } });
    if (isUnexpected(res)) throw new Error(JSON.stringify(res.body));

    expect(res.body.id).toBeString();
    expect(res.body.data.map((item) => item.index)).toEqual([0, 1, 2]);
    expect(res.body.data[0]?.embedding).toEqual(res.body.data[2]?.embedding);
    expect(res.body.data[0]?.embedding).not.toEqual(res.body.data[1]?.embedding);
    expect(res.body.usage.prompt_tokens).toBe(res.body.usage.total_tokens);
  });

  it("returns tool calls", async () => {
    const res = await client.path("/chat/completions").post({
      body: {
        messages: [{ role: "user", content: "weather?" }],
        tools: [
          {
            type: "function",
            function: {
              name: "get_weather",
              parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
            },
          },
        ],
        tool_choice: "required",
      },
    });
    if (isUnexpected(res)) throw new Error(JSON.stringify(res.body));

    expect(res.body.choices[0]?.finish_reason).toBe("tool_calls");
    expect(res.body.choices[0]?.message.tool_calls?.[0]?.function.name).toBe("get_weather");
  });

  it("leaves out the fields the API does not specify", async () => {
    const body = (await raw("/chat/completions", { method: "POST", body: JSON.stringify(hello) }).then((r) =>
      r.json(),
    )) as Record<string, unknown> & { choices: Record<string, unknown>[] };

    expect(body.object).toBeUndefined();
    expect(body.system_fingerprint).toBeUndefined();
    expect(Object.keys(body.choices[0]!).sort()).toEqual(["finish_reason", "index", "message"]);
  });

  it("returns byte-identical responses for identical requests", async () => {
    const [first, second] = await Promise.all([
      raw("/chat/completions", { method: "POST", body: JSON.stringify(hello) }).then((r) => r.text()),
      raw("/chat/completions", { method: "POST", body: JSON.stringify(hello) }).then((r) => r.text()),
    ]);
    expect(first).toBe(second);
  });

  describe("extra parameters", () => {
    const withExtra = (headers: Record<string, string> = {}) =>
      raw("/chat/completions", { method: "POST", headers, body: JSON.stringify({ ...hello, safe_prompt: true }) });

    it("rejects a field outside the API with a 422 naming it, by default", async () => {
      const res = await withExtra();
      expect(res.status).toBe(422);

      const body = (await res.json()) as FlatError;
      expect(body).toEqual({
        status: 422,
        code: "parameter_not_supported",
        message: "One of the parameters contain invalid values.",
        detail: { loc: ["body", "safe_prompt"], input: true },
      });
    });

    it("passes it through, or drops it, when the header says so", async () => {
      expect((await withExtra({ "extra-parameters": "pass-through" })).status).toBe(200);
      expect((await withExtra({ "extra-parameters": "drop" })).status).toBe(200);
    });

    it("reports a missing required field the same way", async () => {
      const res = await raw("/chat/completions", { method: "POST", body: JSON.stringify({}) });
      expect(res.status).toBe(422);

      const body = (await res.json()) as FlatError;
      expect(body.code).toBe("missing");
      expect(body.detail?.loc).toEqual(["body", "messages"]);
    });
  });

  describe("content safety", () => {
    it("fails a blocked prompt with the documented flat error", async () => {
      const res = await raw("/chat/completions", {
        method: "POST",
        headers: { "x-llm-mock-content-filter": "prompt" },
        body: JSON.stringify(hello),
      });
      expect(res.status).toBe(400);

      expect(await res.json()).toEqual({
        status: 400,
        code: "content_filter",
        message: "The response was filtered",
        param: "messages",
        type: null,
      });
    });

    it("cuts a filtered reply and says so in finish_reason", async () => {
      const res = await client
        .path("/chat/completions")
        .post({ body: hello, headers: { "x-llm-mock-content-filter": "completion" } });
      if (isUnexpected(res)) throw new Error(JSON.stringify(res.body));

      expect(res.body.choices[0]?.finish_reason).toBe("content_filter");
      expect(res.body.choices[0]?.message.content).toBeNull();
    });
  });

  describe("routing and authentication", () => {
    it("requires api-version", async () => {
      const res = await raw("/info", {}, null);
      expect(res.status).toBe(400);

      const body = (await res.json()) as FlatError;
      expect(body.status).toBe(400);
      expect(body.code).toBe("MissingApiVersionParameter");
    });

    it("404s an unknown path in the gateway's shape", async () => {
      const res = await raw("/images/generations", { method: "POST", body: "{}" });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ statusCode: 404, message: "Resource not found" });
    });

    it("rejects a missing credential in the gateway's flat shape", async () => {
      const res = await fetch(`${ctx.origin}/azure/models/info?api-version=${API_VERSION}`);
      expect(res.status).toBe(401);

      const body = (await res.json()) as { statusCode: number; message: string };
      expect(body.statusCode).toBe(401);
      expect(body.message).toContain("missing subscription key");
    });

    it("rejects an invalid credential in the wrapped shape, through the SDK too", async () => {
      const bad = createClient(`${ctx.origin}/azure/models`, new AzureKeyCredential(INVALID_API_KEY), {
        allowInsecureConnection: true,
        retryOptions: { maxRetries: 0 },
      });
      const res = await bad.path("/info").get();
      expect(res.status).toBe("401");
      expect((res.body as { error: { code: string } }).error.code).toBe("401");
    });

    it("accepts a bearer token, as Entra ID callers send one", async () => {
      const res = await fetch(`${ctx.origin}/azure/models/info?api-version=${API_VERSION}`, {
        headers: { authorization: `Bearer ${VALID_API_KEY}` },
      });
      expect(res.status).toBe(200);
    });
  });
});
