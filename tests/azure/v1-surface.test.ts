import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { API_VERSION, startTestServer, stopTestServer, VALID_API_KEY, type TestContext } from "./setup";

// Azure's newer surface drops both of the things that make the classic one
// awkward: no api-version, no deployments. A plain OpenAI client works against
// it with nothing but a baseURL change.
describe("azure v1 surface", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestServer();
  });
  afterAll(() => stopTestServer(ctx));

  const post = (path: string, body: unknown) =>
    fetch(`${ctx.baseUrl}${path}`, {
      method: "POST",
      headers: { "api-key": VALID_API_KEY, "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("answers chat completions with a plain OpenAI client", async () => {
    const completion = await ctx.v1.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hello!" }],
    });

    expect(completion.object).toBe("chat.completion");
    expect(completion.choices[0]?.message.content).toBe("Echo: Hello!");
  });

  it("streams", async () => {
    const stream = await ctx.v1.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: "stream this please" }],
      stream: true,
    });

    let text = "";
    for await (const chunk of stream) text += chunk.choices[0]?.delta.content ?? "";
    expect(text).toBe("Echo: stream this please");
  });

  it("embeds", async () => {
    const response = await ctx.v1.embeddings.create({ model: "text-embedding-3-small", input: "hello" });
    expect(response.data[0]?.embedding).toHaveLength(1536);
  });

  it("addresses the model directly, with no deployment in the path", async () => {
    const res = await post("/v1/chat/completions", {
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "hi" }],
    });
    const body = (await res.json()) as { model: string };

    expect(res.status).toBe(200);
    expect(body.model).toBe("gpt-4o-mini");
  });

  it("needs no api-version, where the classic surface demands one", async () => {
    const payload = { model: "gpt-4o", messages: [{ role: "user", content: "hi" }] };

    const withoutVersion = await post("/v1/chat/completions", payload);
    expect(withoutVersion.status).toBe(200);

    const classicWithout = await post("/deployments/d/chat/completions", payload);
    expect(classicWithout.status).toBe(400);
  });

  it("gives both surfaces the same body for the same request", async () => {
    const payload = { model: "gpt-4o", messages: [{ role: "user", content: "same" }] };
    const [v1, classic] = await Promise.all([
      post("/v1/chat/completions", payload).then((r) => r.text()),
      post(`/deployments/d/chat/completions?api-version=${API_VERSION}`, payload).then((r) => r.text()),
    ]);

    expect(v1).toBe(classic);
  });

  it("knows nothing of deployments, so `missing-` is just a model name here", async () => {
    // The reserved prefix belongs to the deployment path; on this surface
    // there is no deployment to be missing.
    const res = await post("/v1/chat/completions", {
      model: "missing-one",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(res.status).toBe(200);
  });
});
