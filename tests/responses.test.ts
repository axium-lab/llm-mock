import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { NotFoundError } from "openai";
import { clearFixtures, registerFixture, startTestServer, stopTestServer, type TestContext } from "./setup";

describe("responses API", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestServer();
  });
  afterAll(() => stopTestServer(ctx));
  afterEach(() => clearFixtures(ctx));

  it("creates a response echoing the input", async () => {
    const response = await ctx.client.responses.create({ model: "gpt-4.1", input: "Ping" });
    expect(response.object).toBe("response");
    expect(response.id).toStartWith("resp_");
    expect(response.status).toBe("completed");
    expect(response.output_text).toBe("Echo: Ping");
    expect(response.usage?.total_tokens).toBeGreaterThan(0);
  });

  it("uses fixtures", async () => {
    await registerFixture(ctx, {
      match: { model: "gpt-4.1" },
      response: { content: "Fixture reply" },
    });
    const response = await ctx.client.responses.create({ model: "gpt-4.1", input: "anything" });
    expect(response.output_text).toBe("Fixture reply");
  });

  it("retrieves a previously created response by id", async () => {
    const created = await ctx.client.responses.create({ model: "gpt-4.1", input: "Remember me" });
    const fetched = await ctx.client.responses.retrieve(created.id);
    expect(fetched.id).toBe(created.id);
    expect(fetched.output_text).toBe("Echo: Remember me");
  });

  it("deletes a response and then returns 404", async () => {
    const created = await ctx.client.responses.create({ model: "gpt-4.1", input: "Delete me" });
    await ctx.client.responses.delete(created.id);
    try {
      await ctx.client.responses.retrieve(created.id);
      throw new Error("expected the request to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundError);
    }
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
