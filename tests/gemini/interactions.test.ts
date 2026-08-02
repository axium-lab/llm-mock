import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { startTestServer, stopTestServer, VALID_API_KEY, type TestContext } from "./setup";

const MODEL = "gemini-3.6-flash";

const WEATHER_TOOL = {
  type: "function" as const,
  name: "get_weather",
  description: "Get the weather for a city",
  parameters: {
    type: "object",
    properties: { city: { type: "string" }, unit: { type: "string", enum: ["celsius", "fahrenheit"] } },
    required: ["city", "unit"],
  },
};

describe("gemini interactions", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestServer();
  });
  afterAll(() => stopTestServer(ctx));

  const post = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${ctx.baseUrl}/v1beta/interactions`, {
      method: "POST",
      headers: { "x-goog-api-key": VALID_API_KEY, "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });

  it("creates an interaction the SDK can read output_text from", async () => {
    const interaction = await ctx.client.interactions.create({ model: MODEL, input: "Explain AI briefly" });

    expect(interaction.status).toBe("completed");
    expect(interaction.output_text).toBe("Echo: Explain AI briefly");
    expect(interaction.id).toBeTruthy();
  });

  it("reports only what the model produced, with no user_input step", async () => {
    const interaction = await ctx.client.interactions.create({ model: MODEL, input: "hello" });

    // The live API does not echo the prompt back on a create; that is what the
    // `include_input` flag on a retrieval is for.
    expect(interaction.steps.map((step) => step.type)).toEqual(["model_output"]);
    expect(interaction.steps[0]).toMatchObject({
      type: "model_output",
      content: [{ type: "text", text: "Echo: hello" }],
    });
  });

  it("identifies itself as an interaction object", async () => {
    const res = await post({ model: MODEL, input: "hello" });
    const body = (await res.json()) as { object: string; service_tier: string };

    expect(body.object).toBe("interaction");
    expect(body.service_tier).toBe("standard");
  });

  it("stamps timestamps to the second, without a fractional part", async () => {
    const interaction = await ctx.client.interactions.create({ model: MODEL, input: "hello" });

    expect(interaction.created).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(interaction.updated).toBe(interaction.created);
  });

  it("reports usage in the snake_case shape this surface uses", async () => {
    const interaction = await ctx.client.interactions.create({ model: MODEL, input: "hello" });
    const usage = interaction.usage;

    expect(usage?.total_tokens).toBe((usage?.total_input_tokens ?? 0) + (usage?.total_output_tokens ?? 0));
    // Lowercase here, where generateContent's usageMetadata spells it "TEXT",
    // and no output breakdown at all — both as the live API reports them.
    expect(usage?.input_tokens_by_modality?.[0]?.modality).toBe("text");
    expect(usage).not.toHaveProperty("output_tokens_by_modality");
    expect(usage?.total_thought_tokens).toBe(0);
  });

  it("counts the system instruction towards the input tokens", async () => {
    const [plain, withSystem] = await Promise.all([
      ctx.client.interactions.create({ model: MODEL, input: "hello" }),
      ctx.client.interactions.create({ model: MODEL, input: "hello", system_instruction: "Be very terse." }),
    ]);

    expect(withSystem.usage?.total_input_tokens).toBeGreaterThan(plain.usage?.total_input_tokens ?? 0);
  });

  it("mints an id with no resource prefix, so a round-trip does not double it", async () => {
    const created = await ctx.client.interactions.create({ model: MODEL, input: "hello" });
    expect(created.id).not.toContain("/");

    const fetched = await ctx.client.interactions.get(created.id);
    expect(fetched.id).toBe(created.id);
  });

  it("synthesizes any id on retrieval, holding no store", async () => {
    const interaction = await ctx.client.interactions.get("never-created-this-one");

    expect(interaction.id).toBe("never-created-this-one");
    expect(interaction.status).toBe("completed");
    expect(interaction.output_text).toContain("never-created-this-one");
  });

  it("cancels into a cancelled status", async () => {
    const interaction = await ctx.client.interactions.cancel("abc123");

    expect(interaction.id).toBe("abc123");
    expect(interaction.status).toBe("cancelled");
  });

  it("deletes idempotently, with the empty body the SDK expects", async () => {
    await ctx.client.interactions.delete("abc123");
    await ctx.client.interactions.delete("abc123");

    const res = await fetch(`${ctx.baseUrl}/v1beta/interactions/abc123`, {
      method: "DELETE",
      headers: { "x-goog-api-key": VALID_API_KEY },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });

  it("pins the reply with the x-llm-mock-response header", async () => {
    const res = await post({ model: MODEL, input: "hi" }, { "x-llm-mock-response": "pinned!" });
    const body = (await res.json()) as { steps: { type: string; content?: { text: string }[] }[] };

    expect(body.steps.find((step) => step.type === "model_output")?.content?.[0]?.text).toBe("pinned!");
  });

  it("reports validation errors in the next-gen envelope, not google.rpc.Status", async () => {
    const res = await post({ model: MODEL });
    expect(res.status).toBe(400);

    const body = (await res.json()) as { error: { code: unknown; message: string; status?: string } };
    expect(body.error.code).toBe("invalid_request");
    expect(body.error.status).toBeUndefined();
  });

  it("requires a model or an agent", async () => {
    const res = await post({ input: "hi" });
    expect(res.status).toBe(400);

    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("'model' or 'agent'");
  });

  it("returns byte-identical interactions for identical requests", async () => {
    const payload = { model: MODEL, input: "same" };
    const [first, second] = await Promise.all([post(payload).then((r) => r.text()), post(payload).then((r) => r.text())]);
    expect(first).toBe(second);
  });

  describe("tool calls", () => {
    it("answers with prose when tool_choice is auto", async () => {
      const interaction = await ctx.client.interactions.create({
        model: MODEL,
        input: "weather?",
        tools: [WEATHER_TOOL],
        generation_config: { tool_choice: "auto" },
      });

      expect(interaction.steps.map((step) => step.type)).toEqual(["model_output"]);
    });

    it("forces a function_call step when tool_choice is any", async () => {
      const interaction = await ctx.client.interactions.create({
        model: MODEL,
        input: "weather?",
        tools: [WEATHER_TOOL],
        generation_config: { tool_choice: "any" },
      });

      const call = interaction.steps.find((step) => step.type === "function_call");
      expect(call).toMatchObject({
        type: "function_call",
        name: "get_weather",
        arguments: { city: "mock", unit: "celsius" },
      });
    });

    it("picks the tool named by allowed_tools", async () => {
      const interaction = await ctx.client.interactions.create({
        model: MODEL,
        input: "anything",
        tools: [
          WEATHER_TOOL,
          { type: "function" as const, name: "search", parameters: { type: "object", properties: {} } },
        ],
        generation_config: { tool_choice: { allowed_tools: { mode: "any", tools: ["search"] } } },
      });

      expect(interaction.steps.find((step) => step.type === "function_call")).toMatchObject({ name: "search" });
    });

    it("terminates the loop once a function_result is in the input", async () => {
      const interaction = await ctx.client.interactions.create({
        model: MODEL,
        input: [
          { type: "user_input", content: [{ type: "text", text: "weather?" }] },
          { type: "function_call", id: "c1", name: "get_weather", arguments: { city: "Valencia" } },
          { type: "function_result", call_id: "c1", name: "get_weather", result: { temp: 30 } },
        ],
        tools: [WEATHER_TOOL],
        generation_config: { tool_choice: "any" },
      });

      expect(interaction.steps.some((step) => step.type === "function_call")).toBe(false);
      expect(interaction.output_text).toBe("Echo: weather?");
    });
  });

  describe("streaming", () => {
    it("emits the created → step → completed event sequence", async () => {
      const stream = await ctx.client.interactions.create({ model: MODEL, input: "stream this", stream: true });

      const types: string[] = [];
      for await (const event of stream) types.push(event.event_type);

      expect(types[0]).toBe("interaction.created");
      expect(types.at(-1)).toBe("interaction.completed");
      expect(types).toContain("step.start");
      expect(types).toContain("step.delta");
      expect(types).toContain("step.stop");
    });

    it("reassembles the same text the non-streaming call returns", async () => {
      const [whole, stream] = await Promise.all([
        ctx.client.interactions.create({ model: MODEL, input: "a prompt long enough to be split" }),
        ctx.client.interactions.create({
          model: MODEL,
          input: "a prompt long enough to be split",
          stream: true,
        }),
      ]);

      let text = "";
      let deltas = 0;
      for await (const event of stream) {
        if (event.event_type === "step.delta" && event.delta?.type === "text") {
          text += event.delta.text;
          deltas += 1;
        }
      }

      expect(whole.output_text).toBe(text);
      expect(deltas).toBeGreaterThan(1);
    });

    it("streams a function call's arguments as arguments_delta pieces", async () => {
      const stream = await ctx.client.interactions.create({
        model: MODEL,
        input: "weather?",
        tools: [WEATHER_TOOL],
        generation_config: { tool_choice: "any" },
        stream: true,
      });

      let encoded = "";
      let completed: unknown;
      for await (const event of stream) {
        if (event.event_type === "step.delta" && event.delta?.type === "arguments_delta") {
          encoded += event.delta.arguments ?? "";
        }
        if (event.event_type === "interaction.completed") completed = event.interaction;
      }

      expect(JSON.parse(encoded)).toEqual({ city: "mock", unit: "celsius" });
      expect(completed).toMatchObject({ status: "completed" });
    });

    it("replays a retrieved interaction as events with ?stream=true", async () => {
      const res = await fetch(`${ctx.baseUrl}/v1beta/interactions/abc123?stream=true`, {
        headers: { "x-goog-api-key": VALID_API_KEY },
      });

      expect(res.headers.get("content-type")).toContain("text/event-stream");
      const raw = await res.text();
      expect(raw).not.toContain("[DONE]");
      expect(raw).toContain("interaction.completed");
    });
  });
});
