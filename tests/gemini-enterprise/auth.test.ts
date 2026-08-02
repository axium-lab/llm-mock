import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { INVALID_API_KEY, startTestServer, stopTestServer, VALID_API_KEY, type TestContext } from "./setup";

interface ErrorBody {
  error: { code: number; message: string; status: string; details?: { reason: string }[] };
}

describe("gemini-enterprise authentication", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestServer();
  });
  afterAll(() => stopTestServer(ctx));

  const models = () => `${ctx.baseUrl}/v1beta1/publishers/google/models`;

  it("accepts an OAuth bearer token, which is how regional callers authenticate", async () => {
    const res = await fetch(models(), { headers: { authorization: `Bearer ${VALID_API_KEY}` } });
    expect(res.status).toBe(200);
  });

  it("accepts an API key, which is how express mode authenticates", async () => {
    const res = await fetch(models(), { headers: { "x-goog-api-key": VALID_API_KEY } });
    expect(res.status).toBe(200);
  });

  it("accepts the key in the ?key= query parameter", async () => {
    const res = await fetch(`${models()}?key=${VALID_API_KEY}`);
    expect(res.status).toBe(200);
  });

  it("rejects a request with no credential as UNAUTHENTICATED", async () => {
    const res = await fetch(models());
    expect(res.status).toBe(401);

    const body = (await res.json()) as ErrorBody;
    expect(body.error.status).toBe("UNAUTHENTICATED");
    expect(body.error.message).toContain("Expected OAuth 2 access token");
    expect(body.error.details).toBeUndefined();
  });

  it("rejects a bad bearer token as UNAUTHENTICATED, not as a bad argument", async () => {
    const res = await fetch(models(), { headers: { authorization: "Bearer not-a-real-token" } });
    expect(res.status).toBe(401);

    const body = (await res.json()) as ErrorBody;
    expect(body.error.status).toBe("UNAUTHENTICATED");
  });

  it("rejects a bad API key the way express mode does, as INVALID_ARGUMENT", async () => {
    const res = await fetch(models(), { headers: { "x-goog-api-key": INVALID_API_KEY } });
    expect(res.status).toBe(400);

    // The two transports fail differently: an OAuth token is an authentication
    // problem, an API key a bad argument.
    const body = (await res.json()) as ErrorBody;
    expect(body.error.status).toBe("INVALID_ARGUMENT");
    expect(body.error.details?.[0]?.reason).toBe("API_KEY_INVALID");
  });

  it("names aiplatform.googleapis.com as the service, not generativelanguage", async () => {
    const res = await fetch(models(), { headers: { "x-goog-api-key": INVALID_API_KEY } });
    const body = (await res.json()) as { error: { details?: { metadata: { service: string } }[] } };

    expect(body.error.details?.[0]?.metadata.service).toBe("aiplatform.googleapis.com");
  });

  it("guards the regional path too", async () => {
    const res = await fetch(
      `${ctx.baseUrl}/v1beta1/projects/p/locations/europe-west1/publishers/google/models/gemini-3.6-flash`,
    );
    expect(res.status).toBe(401);
  });
});
