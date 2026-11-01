import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { API_VERSION, startTestServer, stopTestServer, VALID_API_KEY, type TestContext } from "./setup";

interface ErrorBody {
  error: { code: string; message: string };
}

// The Responses API is not deployment-scoped on Azure: the SDK sends it to
// /openai/responses?api-version= on the classic surface and to
// /openai/v1/responses on the other, with OpenAI's payloads on both.
describe("azure responses API", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestServer();
  });
  afterAll(() => stopTestServer(ctx));

  const raw = (path: string, init?: RequestInit) =>
    fetch(`${ctx.baseUrl}${path}`, { ...init, headers: { "api-key": VALID_API_KEY, ...init?.headers } });

  for (const [surface, client] of [
    ["classic", () => ctx.classic],
    ["v1", () => ctx.v1],
  ] as const) {
    describe(`${surface} surface`, () => {
      it("creates a response echoing the input", async () => {
        const response = await client().responses.create({ model: "gpt-4o", input: "Ping" });
        expect(response.object).toBe("response");
        expect(response.id).toStartWith("resp_");
        expect(response.status).toBe("completed");
        expect(response.output_text).toBe("Echo: Ping");
      });

      it("streams typed events ending with response.completed", async () => {
        const stream = await client().responses.create({ model: "gpt-4o", input: "stream this", stream: true });
        const types: string[] = [];
        let text = "";
        for await (const event of stream) {
          types.push(event.type);
          if (event.type === "response.output_text.delta") text += event.delta;
        }
        expect(types[0]).toBe("response.created");
        expect(types[types.length - 1]).toBe("response.completed");
        expect(text).toBe("Echo: stream this");
      });

      it("retrieves, cancels and deletes any id without a store", async () => {
        const fetched = await client().responses.retrieve("resp_abc123");
        expect(fetched.id).toBe("resp_abc123");
        expect(fetched.status).toBe("completed");

        const cancelled = await client().responses.cancel("resp_abc123");
        expect(cancelled.status).toBe("cancelled");
        expect(cancelled.background).toBe(true);

        const deleted = await client().responses.delete("resp_abc123");
        expect(deleted).toMatchObject({ id: "resp_abc123", object: "response", deleted: true });
      });
    });
  }

  it("gives both surfaces the same body for the same request", async () => {
    const payload = { model: "gpt-4o", input: "same" };
    const post = (path: string) =>
      raw(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }).then((r) => r.text());

    const [v1, classic] = await Promise.all([
      post("/v1/responses"),
      post(`/responses?api-version=${API_VERSION}`),
    ]);
    expect(v1).toBe(classic);
  });

  it("requires api-version on the classic surface only", async () => {
    const body = JSON.stringify({ model: "gpt-4o", input: "hi" });
    const headers = { "content-type": "application/json" };

    const classic = await raw("/responses", { method: "POST", headers, body });
    expect(classic.status).toBe(400);
    expect(((await classic.json()) as ErrorBody).error.code).toBe("MissingApiVersionParameter");

    const v1 = await raw("/v1/responses", { method: "POST", headers, body });
    expect(v1.status).toBe(200);
  });

  it("reports a missing input in Azure's envelope", async () => {
    const res = await raw(`/responses?api-version=${API_VERSION}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o" }),
    });
    expect(res.status).toBe(400);

    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe("missing_required_parameter");
    expect(body.error.message).toContain("'input'");
  });
});
