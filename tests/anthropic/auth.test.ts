import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  API_VERSION,
  headers,
  INVALID_API_KEY,
  startTestServer,
  stopTestServer,
  VALID_API_KEY,
  type TestContext,
} from "./setup";

interface ErrorBody {
  type: "error";
  error: { type: string; message: string };
  request_id: string;
}

describe("anthropic authentication", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestServer();
  });
  afterAll(() => stopTestServer(ctx));

  const models = () => `${ctx.baseURL}/v1/models`;

  it("accepts the key in x-api-key, which is this API's own scheme", async () => {
    const res = await fetch(models(), { headers: headers() });
    expect(res.status).toBe(200);
  });

  it("accepts a bearer token, which is how OAuth callers authenticate", async () => {
    const res = await fetch(models(), {
      headers: { authorization: `Bearer ${VALID_API_KEY}`, "anthropic-version": API_VERSION },
    });
    expect(res.status).toBe(200);
  });

  it("rejects a missing credential", async () => {
    const res = await fetch(models(), { headers: { "anthropic-version": API_VERSION } });
    expect(res.status).toBe(401);

    const body = (await res.json()) as ErrorBody;
    expect(body.type).toBe("error");
    expect(body.error.type).toBe("authentication_error");
    expect(body.error.message).toBe("x-api-key header is required");
  });

  it("rejects an invalid credential", async () => {
    const res = await fetch(models(), { headers: headers(INVALID_API_KEY) });
    expect(res.status).toBe(401);

    const body = (await res.json()) as ErrorBody;
    expect(body.error.type).toBe("authentication_error");
    expect(body.error.message).toBe("invalid x-api-key");
  });

  it("requires the anthropic-version header", async () => {
    const res = await fetch(models(), { headers: { "x-api-key": VALID_API_KEY } });
    expect(res.status).toBe(400);

    const body = (await res.json()) as ErrorBody;
    expect(body.error.type).toBe("invalid_request_error");
    expect(body.error.message).toBe("anthropic-version header is required");
  });

  it("accepts any version value, rather than policing a list", async () => {
    const res = await fetch(models(), {
      headers: { "x-api-key": VALID_API_KEY, "anthropic-version": "2099-01-01" },
    });
    expect(res.status).toBe(200);
  });
});

describe("anthropic error envelope", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestServer();
  });
  afterAll(() => stopTestServer(ctx));

  it("wraps the error twice and names the type", async () => {
    const res = await fetch(`${ctx.baseURL}/v1/nope`, { headers: headers() });
    expect(res.status).toBe(404);

    const body = (await res.json()) as ErrorBody;
    // Unlike every other provider here, the envelope carries a top-level
    // `type: "error"` around the error object itself.
    expect(body.type).toBe("error");
    expect(body.error.type).toBe("not_found_error");
  });

  it("echoes the request id, matching the response header", async () => {
    const res = await fetch(`${ctx.baseURL}/v1/nope`, { headers: headers() });
    const body = (await res.json()) as ErrorBody;

    expect(body.request_id).toStartWith("req_");
    expect(body.request_id).toBe(res.headers.get("x-request-id") ?? "");
  });
});
