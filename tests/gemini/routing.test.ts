import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { parseRpcTarget } from "../../src/providers/google-shared/rpc-path";
import { startTestServer, stopTestServer, VALID_API_KEY, type TestContext } from "./setup";

describe("parseRpcTarget", () => {
  it("splits a custom method off the resource", () => {
    expect(parseRpcTarget("gemini-3.6-flash:generateContent")).toEqual({
      resource: "gemini-3.6-flash",
      method: "generateContent",
    });
  });

  it("leaves a plain resource read without a method", () => {
    expect(parseRpcTarget("gemini-3.6-flash")).toEqual({ resource: "gemini-3.6-flash" });
  });

  it("keeps dots and dashes in the resource id", () => {
    expect(parseRpcTarget("gemini-3.5-flash-lite:countTokens").resource).toBe("gemini-3.5-flash-lite");
  });
});

describe("gemini routing", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestServer();
  });
  afterAll(() => stopTestServer(ctx));

  const headers = { "x-goog-api-key": VALID_API_KEY };

  it("parses the :method suffix out of the model segment", async () => {
    const res = await fetch(`${ctx.baseUrl}/v1beta/models/gemini-3.6-flash:notAMethod`, {
      method: "POST",
      headers,
    });
    expect(res.status).toBe(404);

    const body = (await res.json()) as { error: { message: string } };
    // Both halves of the segment come back named, which only happens if the
    // colon was split rather than swallowed by the route pattern.
    expect(body.error.message).toContain("models/gemini-3.6-flash is not found");
    expect(body.error.message).toContain("is not supported for notAMethod");
  });

  it("uses the google.rpc.Status envelope on the classic surface", async () => {
    const res = await fetch(`${ctx.baseUrl}/v1beta/nope`, { headers });
    const body = (await res.json()) as { error: { code: unknown; status: string } };

    expect(body.error.code).toBe(404);
    expect(body.error.status).toBe("NOT_FOUND");
  });

  it("uses the next-gen envelope under /interactions", async () => {
    const res = await fetch(`${ctx.baseUrl}/v1beta/interactions/abc/nope`, { headers });
    const body = (await res.json()) as { error: { code: unknown; status?: string } };

    expect(res.status).toBe(404);
    // A string code and no `status` field is what tells the two envelopes apart.
    expect(body.error.code).toBe("not_found");
    expect(body.error.status).toBeUndefined();
  });
});
