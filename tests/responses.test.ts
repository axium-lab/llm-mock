import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { startTestServer, stopTestServer, VALID_API_KEY, type TestContext } from "./setup";

describe("responses API", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestServer();
  });
  afterAll(() => stopTestServer(ctx));

  it("creates a response echoing the input", async () => {
    const response = await ctx.client.responses.create({ model: "gpt-4.1", input: "Ping" });
    expect(response.object).toBe("response");
    expect(response.id).toStartWith("resp_");
    expect(response.status).toBe("completed");
    expect(response.output_text).toBe("Echo: Ping");
    expect(response.usage?.total_tokens).toBeGreaterThan(0);
  });

  it("returns the canned response carried by the x-llm-mock-response header", async () => {
    const response = await ctx.client.responses.create(
      { model: "gpt-4.1", input: "anything" },
      { headers: { "x-llm-mock-response": "Canned reply" } },
    );
    expect(response.output_text).toBe("Canned reply");
  });

  it("retrieval is stateless: any id yields a deterministic synthetic response", async () => {
    const fetched = await ctx.client.responses.retrieve("resp_abc123");
    expect(fetched.id).toBe("resp_abc123");
    expect(fetched.object).toBe("response");
    expect(fetched.status).toBe("completed");
    expect(fetched.output_text).toBe("Echo response resp_abc123");

    const again = await ctx.client.responses.retrieve("resp_abc123");
    expect(again).toEqual(fetched);
  });

  it("deletion is idempotent and never 404s", async () => {
    const remove = () =>
      fetch(`${ctx.baseURL}/responses/resp_abc123`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${VALID_API_KEY}` },
      });
    const first = await remove();
    expect(first.status).toBe(200);
    expect(((await first.json()) as { deleted: boolean }).deleted).toBe(true);
    const second = await remove();
    expect(((await second.json()) as { deleted: boolean }).deleted).toBe(true);
  });

  it("streams typed events ending with response.completed", async () => {
    const stream = await ctx.client.responses.create({
      model: "gpt-4.1",
      input: "Stream me a long enough sentence to get several deltas",
      stream: true,
    });

    const types: string[] = [];
    let text = "";
    for await (const event of stream) {
      types.push(event.type);
      if (event.type === "response.output_text.delta") text += event.delta;
    }

    expect(types[0]).toBe("response.created");
    expect(types).toContain("response.output_text.delta");
    expect(types[types.length - 1]).toBe("response.completed");
    expect(text).toBe("Echo: Stream me a long enough sentence to get several deltas");
  });
});
