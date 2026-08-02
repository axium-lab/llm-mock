import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { parseScope } from "../../src/providers/gemini-enterprise/scope";
import { INVALID_API_KEY, LOCATION, PROJECT, startTestServer, stopTestServer, VALID_API_KEY, type TestContext } from "./setup";

const MODEL = "gemini-3.6-flash";

describe("parseScope", () => {
  it("reads the express form, which is just a version", () => {
    expect(parseScope("v1beta1")).toEqual({ version: "v1beta1", project: undefined, location: undefined });
  });

  it("reads the regional form, version and location folded together", () => {
    expect(parseScope("v1beta1/projects/my-project/locations/europe-west1")).toEqual({
      version: "v1beta1",
      project: "my-project",
      location: "europe-west1",
    });
  });

  it("accepts v1 as well as v1beta1", () => {
    expect(parseScope("v1")?.version).toBe("v1");
  });

  it("rejects anything else", () => {
    expect(parseScope("v9beta/projects/p")).toBeUndefined();
    expect(parseScope("publishers/google/models")).toBeUndefined();
  });
});

describe("gemini-enterprise interactions", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestServer();
  });
  afterAll(() => stopTestServer(ctx));

  // What the SDK actually puts on the wire in regional mode: the whole
  // version-and-location component, percent-encoded into one path segment.
  const encodedScope = encodeURIComponent(`v1beta1/projects/${PROJECT}/locations/${LOCATION}`);

  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${ctx.baseUrl}${path}`, {
      method: "POST",
      headers: { "x-goog-api-key": VALID_API_KEY, "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });

  it("creates through the express client", async () => {
    const interaction = await ctx.express.interactions.create({ model: MODEL, input: "Hello!" });

    expect(interaction.status).toBe("completed");
    expect(interaction.output_text).toBe("Echo: Hello!");
  });

  it("creates through the regional client, whose path arrives percent-encoded", async () => {
    const interaction = await ctx.regional.interactions.create({ model: MODEL, input: "Hello!" });

    expect(interaction.output_text).toBe("Echo: Hello!");
    expect(interaction.steps.map((step) => step.type)).toEqual(["model_output"]);
  });

  it("routes the encoded regional path a literal version mount would miss", async () => {
    const res = await post(`/${encodedScope}/interactions`, { model: MODEL, input: "hi" });
    expect(res.status).toBe(200);

    const body = (await res.json()) as { steps: { content?: { text: string }[] }[] };
    expect(body.steps[0]?.content?.[0]?.text).toBe("Echo: hi");
  });

  it("gives both modes the same interaction", async () => {
    const [regional, express] = await Promise.all([
      ctx.regional.interactions.create({ model: MODEL, input: "same" }),
      ctx.express.interactions.create({ model: MODEL, input: "same" }),
    ]);

    expect(regional.id).toBe(express.id);
  });

  it("retrieves, cancels and deletes", async () => {
    const fetched = await ctx.express.interactions.get("abc123");
    expect(fetched.id).toBe("abc123");

    const cancelled = await ctx.regional.interactions.cancel("abc123");
    expect(cancelled.status).toBe("cancelled");

    await ctx.regional.interactions.delete("abc123");
  });

  it("streams the created → step → completed sequence in both modes", async () => {
    for (const client of [ctx.regional, ctx.express]) {
      const stream = await client.interactions.create({ model: MODEL, input: "stream me", stream: true });

      const types: string[] = [];
      for await (const event of stream) types.push(event.event_type);

      expect(types[0]).toBe("interaction.created");
      expect(types.at(-1)).toBe("interaction.completed");
      expect(types).toContain("step.delta");
    }
  });

  it("reports a validation error in the next-gen envelope", async () => {
    const res = await post(`/${encodedScope}/interactions`, { model: MODEL });
    expect(res.status).toBe(400);

    const body = (await res.json()) as { error: { code: unknown; status?: string } };
    expect(body.error.code).toBe("invalid_request");
    expect(body.error.status).toBeUndefined();
  });

  it("reports a credential failure in the classic envelope, as the frontend does", async () => {
    const res = await post("/v1beta1/interactions", { model: MODEL, input: "hi" }, {
      "x-goog-api-key": INVALID_API_KEY,
    });
    expect(res.status).toBe(400);

    const body = (await res.json()) as { error: { code: unknown; status: string } };
    expect(body.error.code).toBe(400);
    expect(body.error.status).toBe("INVALID_ARGUMENT");
  });

  it("404s a scope that is not a version this platform serves", async () => {
    const res = await post("/v9beta%2Fprojects%2Fp/interactions", { model: MODEL, input: "hi" });
    expect(res.status).toBe(404);

    const body = (await res.json()) as { error: { code: unknown; message: string } };
    expect(body.error.code).toBe("not_found");
    expect(body.error.message).toContain("Unknown API version or location");
  });

  it("leaves the publisher models surface untouched", async () => {
    const res = await fetch(`${ctx.baseUrl}/v1beta1/publishers/google/models`, {
      headers: { "x-goog-api-key": VALID_API_KEY },
    });
    const body = (await res.json()) as { publisherModels: unknown[] };

    expect(res.status).toBe(200);
    expect(body.publisherModels.length).toBeGreaterThan(0);
  });
});
