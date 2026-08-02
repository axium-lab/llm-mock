import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { LOCATION, PROJECT, startTestServer, stopTestServer, VALID_API_KEY, type TestContext } from "./setup";

const MODEL = "gemini-3.6-flash";

describe("gemini-enterprise publisher models", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestServer();
  });
  afterAll(() => stopTestServer(ctx));

  const key = { "x-goog-api-key": VALID_API_KEY };
  const oauth = { authorization: `Bearer ${VALID_API_KEY}` };
  const regionalPath = `/v1beta1/projects/${PROJECT}/locations/${LOCATION}/publishers/google/models`;

  it("lists the catalog through the express client", async () => {
    const pager = await ctx.express.models.list();
    const names: (string | undefined)[] = [];
    for await (const model of pager) names.push(model.name);

    expect(names).toContain("publishers/google/models/gemini-3.6-flash");
    expect(names).toContain("publishers/google/models/text-embedding-005");
  });

  it("lists the catalog through the regional client too", async () => {
    // The SDK asks for the listing without a project or a location even in
    // regional mode, so both clients land on the same global path.
    const pager = await ctx.regional.models.list();
    expect(pager.pageLength).toBeGreaterThan(0);
  });

  it("nests the collection under `publisherModels`", async () => {
    const res = await fetch(`${ctx.baseUrl}/v1beta1/publishers/google/models`, { headers: key });
    const body = (await res.json()) as { publisherModels: { name: string }[] };

    expect(Array.isArray(body.publisherModels)).toBe(true);
    expect(body.publisherModels[0]?.name).toStartWith("publishers/google/models/");
  });

  it("retrieves a model with the fields this platform reports", async () => {
    const res = await fetch(`${ctx.baseUrl}/v1beta1/publishers/google/models/${MODEL}`, { headers: key });
    const body = (await res.json()) as Record<string, unknown>;

    // `versionId`, not `version`, and no token limits: fewer fields than the
    // AI Studio catalog carries.
    expect(body).toEqual({
      name: `publishers/google/models/${MODEL}`,
      versionId: "3.6",
      displayName: "Gemini 3.6 Flash",
      description: "Frontier-class model balancing capability and cost.",
      launchStage: "GA",
    });
  });

  it("maps versionId onto the SDK's `version`", async () => {
    const model = await ctx.express.models.get({ model: MODEL });

    expect(model.name).toBe(`publishers/google/models/${MODEL}`);
    expect(model.version).toBe("3.6");
  });

  it("serves the regional and express paths identically", async () => {
    const [regional, express] = await Promise.all([
      fetch(`${ctx.baseUrl}${regionalPath}/${MODEL}`, { headers: oauth }).then((r) => r.json()),
      fetch(`${ctx.baseUrl}/v1beta1/publishers/google/models/${MODEL}`, { headers: key }).then((r) => r.json()),
    ]);

    expect(regional).toEqual(express);
  });

  it("serves v1 and v1beta1 identically", async () => {
    const [beta, stable] = await Promise.all([
      fetch(`${ctx.baseUrl}/v1beta1/publishers/google/models`, { headers: key }).then((r) => r.json()),
      fetch(`${ctx.baseUrl}/v1/publishers/google/models`, { headers: key }).then((r) => r.json()),
    ]);

    expect(stable).toEqual(beta);
  });

  it("404s an unknown model in this platform's wording", async () => {
    const res = await fetch(`${ctx.baseUrl}/v1beta1/publishers/google/models/no-such-model`, { headers: key });
    expect(res.status).toBe(404);

    const body = (await res.json()) as { error: { message: string; status: string } };
    expect(body.error.status).toBe("NOT_FOUND");
    expect(body.error.message).toContain("Publisher Model `publishers/google/models/no-such-model` was not found");
  });

  it("parses the :method suffix on both path shapes", async () => {
    for (const path of [`${regionalPath}/${MODEL}:notAMethod`, `/v1beta1/publishers/google/models/${MODEL}:notAMethod`]) {
      const res = await fetch(`${ctx.baseUrl}${path}`, {
        method: "POST",
        headers: { ...oauth, "content-type": "application/json" },
        body: "{}",
      });
      expect(res.status).toBe(404);

      const body = (await res.json()) as { error: { message: string } };
      expect(body.error.message).toContain("notAMethod is supported for it");
    }
  });
});
