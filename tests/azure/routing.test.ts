import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { API_VERSION, startTestServer, stopTestServer, VALID_API_KEY, type TestContext } from "./setup";

interface ErrorBody {
  error: { code: string; message: string };
}

describe("azure routing", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestServer();
  });
  afterAll(() => stopTestServer(ctx));

  const key = { "api-key": VALID_API_KEY };

  const raw = (path: string, init?: RequestInit) =>
    fetch(`${ctx.baseUrl}${path}`, { ...init, headers: { ...key, ...init?.headers } });

  it("serves the model catalog on the classic surface", async () => {
    const models = await ctx.classic.models.list();
    expect(models.data.map((model) => model.id)).toContain("gpt-4o");
  });

  it("serves the same catalog on the v1 surface", async () => {
    const models = await ctx.v1.models.list();
    expect(models.data.map((model) => model.id)).toContain("gpt-4o");
  });

  it("requires api-version on the classic surface", async () => {
    const res = await raw("/models");
    expect(res.status).toBe(400);

    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe("MissingApiVersionParameter");
  });

  it("does not require api-version on the v1 surface", async () => {
    const res = await raw("/v1/models");
    expect(res.status).toBe(200);
  });

  it("404s an unimplemented v1 path instead of blaming api-version", async () => {
    // The v1 tree is terminal: without that, this would fall through to the
    // classic tree and be rejected for a missing api-version, which would be a
    // misleading answer for a path that simply does not exist here.
    const res = await raw("/v1/audio/speech", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(404);

    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe("404");
  });

  it("routes any deployment name to the inference handlers", async () => {
    // The SDK turns `model` into the deployment segment when no fixed
    // deployment is configured on the client, so the two need not agree.
    const res = await raw(`/deployments/whatever-i-called-it/chat/completions?api-version=${API_VERSION}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(200);
  });

  it("404s a deployment-scoped path this mock does not serve", async () => {
    const res = await raw(`/deployments/my-deployment/audio/speech?api-version=${API_VERSION}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(404);

    const body = (await res.json()) as ErrorBody;
    expect(body.error.message).toContain("/deployments/my-deployment/audio/speech");
  });

  it("reports a reserved deployment name as DeploymentNotFound", async () => {
    const res = await raw(`/deployments/missing-one/chat/completions?api-version=${API_VERSION}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "missing-one", messages: [] }),
    });
    expect(res.status).toBe(404);

    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe("DeploymentNotFound");
    expect(body.error.message).toContain("The API deployment for this resource does not exist");
  });

  it("surfaces DeploymentNotFound through the SDK", async () => {
    try {
      await ctx.classic.chat.completions.create({
        model: "missing-one",
        messages: [{ role: "user", content: "hi" }],
      });
      throw new Error("expected the request to fail");
    } catch (error) {
      expect((error as Error).message).toContain("deployment for this resource does not exist");
    }
  });
});
