import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { API_VERSION, INVALID_API_KEY, startTestServer, stopTestServer, VALID_API_KEY, type TestContext } from "./setup";

describe("azure authentication", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestServer();
  });
  afterAll(() => stopTestServer(ctx));

  const models = () => `${ctx.baseUrl}/models?api-version=${API_VERSION}`;

  it("accepts the key in the api-key header, which is Azure's own scheme", async () => {
    const res = await fetch(models(), { headers: { "api-key": VALID_API_KEY } });
    expect(res.status).toBe(200);
  });

  it("accepts a bearer token, which is how Entra ID callers authenticate", async () => {
    const res = await fetch(models(), { headers: { authorization: `Bearer ${VALID_API_KEY}` } });
    expect(res.status).toBe(200);
  });

  it("rejects a missing credential in the gateway's flatter shape", async () => {
    const res = await fetch(models());
    expect(res.status).toBe(401);

    // No `error` wrapper: this is Azure's API gateway answering, ahead of the
    // service that would have produced one.
    const body = (await res.json()) as { statusCode: number; message: string; error?: unknown };
    expect(body.statusCode).toBe(401);
    expect(body.message).toContain("missing subscription key");
    expect(body.error).toBeUndefined();
  });

  it("rejects an invalid credential in the wrapped shape", async () => {
    const res = await fetch(models(), { headers: { "api-key": INVALID_API_KEY } });
    expect(res.status).toBe(401);

    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("401");
    expect(body.error.message).toContain("invalid subscription key");
  });

  it("guards the v1 surface as well", async () => {
    const res = await fetch(`${ctx.baseUrl}/v1/models`);
    expect(res.status).toBe(401);
  });
});
