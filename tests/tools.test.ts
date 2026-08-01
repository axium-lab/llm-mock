import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type OpenAI from "openai";
import { startTestServer, stopTestServer, type TestContext } from "./setup";

const WEATHER_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "get_weather",
    description: "Get the current weather for a city",
    parameters: {
      type: "object",
      properties: {
        city: { type: "string" },
        unit: { type: "string", enum: ["celsius", "fahrenheit"] },
        days: { type: "integer" },
      },
      required: ["city", "unit"],
    },
  },
};

// The SDK types tool_calls as function | custom; the mock only emits the
// former, so narrow once here instead of at every assertion.
function functionCall(
  call: OpenAI.Chat.Completions.ChatCompletionMessageToolCall | undefined,
): OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall {
  if (call?.type !== "function") throw new Error("expected a function tool call");
  return call;
}

const RESPONSES_WEATHER_TOOL = {
  type: "function" as const,
  name: "get_weather",
  description: "Get the current weather for a city",
  parameters: {
    type: "object",
    properties: { city: { type: "string" }, unit: { type: "string", enum: ["celsius", "fahrenheit"] } },
    required: ["city", "unit"],
  },
  strict: false,
};

describe("tool calls (chat completions)", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestServer();
  });
  afterAll(() => stopTestServer(ctx));

  it("calls the first tool when tool_choice is required", async () => {
    const completion = await ctx.client.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: "Weather in Valencia?" }],
      tools: [WEATHER_TOOL],
      tool_choice: "required",
    });

    const choice = completion.choices[0]!;
    expect(choice.finish_reason).toBe("tool_calls");
    expect(choice.message.content).toBeNull();
    const call = functionCall(choice.message.tool_calls?.[0]);
    expect(call.id).toStartWith("call_");
    expect(call.function.name).toBe("get_weather");
    // Arguments are synthesized from the schema: required properties only,
    // enums resolved to their first value.
    expect(JSON.parse(call.function.arguments)).toEqual({ city: "mock", unit: "celsius" });
  });

  it("calls the named tool when tool_choice names one", async () => {
    const completion = await ctx.client.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: "Anything" }],
      tools: [
        { type: "function", function: { name: "get_time", parameters: { type: "object", properties: {} } } },
        WEATHER_TOOL,
      ],
      tool_choice: { type: "function", function: { name: "get_weather" } },
    });
    expect(functionCall(completion.choices[0]?.message.tool_calls?.[0]).function.name).toBe("get_weather");
  });

  it("answers with text when tool_choice is auto or none", async () => {
    for (const tool_choice of ["auto", "none"] as const) {
      const completion = await ctx.client.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: "Hi" }],
        tools: [WEATHER_TOOL],
        tool_choice,
      });
      expect(completion.choices[0]?.finish_reason).toBe("stop");
      expect(completion.choices[0]?.message.content).toBe("Echo: Hi");
      expect(completion.choices[0]?.message.tool_calls).toBeUndefined();
    }
  });

  it("returns the tool calls carried by the x-llm-mock-tool-calls header", async () => {
    const completion = await ctx.client.chat.completions.create(
      { model: "gpt-4o", messages: [{ role: "user", content: "Weather?" }] },
      {
        headers: {
          "x-llm-mock-tool-calls": JSON.stringify([
            { name: "get_weather", arguments: { city: "Valencia", unit: "celsius" } },
          ]),
        },
      },
    );

    const call = functionCall(completion.choices[0]?.message.tool_calls?.[0]);
    expect(call.function.name).toBe("get_weather");
    expect(JSON.parse(call.function.arguments)).toEqual({ city: "Valencia", unit: "celsius" });
    expect(completion.choices[0]?.finish_reason).toBe("tool_calls");
  });

  it("emits parallel tool calls with distinct ids", async () => {
    const completion = await ctx.client.chat.completions.create(
      { model: "gpt-4o", messages: [{ role: "user", content: "Two cities" }] },
      {
        headers: {
          "x-llm-mock-tool-calls": JSON.stringify([
            { name: "get_weather", arguments: { city: "Valencia" } },
            { name: "get_weather", arguments: { city: "Madrid" } },
          ]),
        },
      },
    );

    const calls = completion.choices[0]!.message.tool_calls!;
    expect(calls).toHaveLength(2);
    expect(calls[0]!.id).not.toBe(calls[1]!.id);
    expect(JSON.parse(functionCall(calls[1]).function.arguments)).toEqual({ city: "Madrid" });
  });

  it("stops calling tools once a tool result is in the conversation", async () => {
    const completion = await ctx.client.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "user", content: "Weather in Valencia?" },
        {
          role: "assistant",
          tool_calls: [
            { id: "call_1", type: "function", function: { name: "get_weather", arguments: "{}" } },
          ],
        },
        { role: "tool", tool_call_id: "call_1", content: "22C, sunny" },
      ],
      tools: [WEATHER_TOOL],
      tool_choice: "required",
    });

    expect(completion.choices[0]?.finish_reason).toBe("stop");
    expect(completion.choices[0]?.message.content).toBe("Echo: Weather in Valencia?");
  });

  it("streams tool calls as reassemblable deltas", async () => {
    const stream = await ctx.client.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: "Weather?" }],
      tools: [WEATHER_TOOL],
      tool_choice: "required",
      stream: true,
    });

    const names: string[] = [];
    let args = "";
    let finishReason: string | null = null;
    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      for (const call of choice?.delta.tool_calls ?? []) {
        if (call.function?.name) names.push(call.function.name);
        args += call.function?.arguments ?? "";
      }
      if (choice?.finish_reason) finishReason = choice.finish_reason;
    }

    expect(names).toEqual(["get_weather"]);
    expect(JSON.parse(args)).toEqual({ city: "mock", unit: "celsius" });
    expect(finishReason).toBe("tool_calls");
  });

  it("rejects a malformed x-llm-mock-tool-calls header", async () => {
    const response = await fetch(`${ctx.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer sk-mock-key-01",
        "x-llm-mock-tool-calls": "not json",
      },
      body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: "Hi" }] }),
    });
    expect(response.status).toBe(400);
  });
});

describe("tool calls (responses)", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestServer();
  });
  afterAll(() => stopTestServer(ctx));

  it("emits a function_call output item when tool_choice is required", async () => {
    const response = await ctx.client.responses.create({
      model: "gpt-4o",
      input: "Weather in Valencia?",
      tools: [RESPONSES_WEATHER_TOOL],
      tool_choice: "required",
    });

    const item = response.output[0]!;
    expect(item.type).toBe("function_call");
    if (item.type !== "function_call") throw new Error("expected a function_call item");
    expect(item.id).toStartWith("fc_");
    expect(item.call_id).toStartWith("call_");
    expect(item.name).toBe("get_weather");
    expect(JSON.parse(item.arguments)).toEqual({ city: "mock", unit: "celsius" });
    expect(response.output_text).toBe("");
  });

  it("echoes the requested tools and tool_choice", async () => {
    const response = await ctx.client.responses.create({
      model: "gpt-4o",
      input: "Hi",
      tools: [RESPONSES_WEATHER_TOOL],
      tool_choice: "auto",
    });
    expect(response.tools).toHaveLength(1);
    expect(response.tool_choice).toBe("auto");
    expect(response.output_text).toBe("Echo: Hi");
  });

  it("returns the tool calls carried by the header", async () => {
    const response = await ctx.client.responses.create(
      { model: "gpt-4o", input: "Weather?" },
      {
        headers: {
          "x-llm-mock-tool-calls": JSON.stringify({ name: "get_weather", arguments: { city: "Valencia" } }),
        },
      },
    );

    const item = response.output[0]!;
    if (item.type !== "function_call") throw new Error("expected a function_call item");
    expect(JSON.parse(item.arguments)).toEqual({ city: "Valencia" });
  });

  it("stops calling tools once a function_call_output is in the input", async () => {
    const response = await ctx.client.responses.create({
      model: "gpt-4o",
      input: [
        { role: "user", content: "Weather in Valencia?" },
        { type: "function_call", call_id: "call_1", name: "get_weather", arguments: "{}" },
        { type: "function_call_output", call_id: "call_1", output: "22C, sunny" },
      ],
      tools: [RESPONSES_WEATHER_TOOL],
      tool_choice: "required",
    });

    expect(response.output[0]?.type).toBe("message");
    expect(response.output_text).toBe("Echo: Weather in Valencia?");
  });

  it("streams function call arguments as typed events", async () => {
    const stream = await ctx.client.responses.create({
      model: "gpt-4o",
      input: "Weather?",
      tools: [RESPONSES_WEATHER_TOOL],
      tool_choice: "required",
      stream: true,
    });

    const types: string[] = [];
    let args = "";
    for await (const event of stream) {
      types.push(event.type);
      if (event.type === "response.function_call_arguments.delta") args += event.delta;
      if (event.type === "response.function_call_arguments.done") expect(event.arguments).toBe(args);
    }

    expect(types[0]).toBe("response.created");
    expect(types).toContain("response.output_item.added");
    expect(types).toContain("response.function_call_arguments.done");
    expect(types.at(-1)).toBe("response.completed");
    expect(JSON.parse(args)).toEqual({ city: "mock", unit: "celsius" });
  });
});
