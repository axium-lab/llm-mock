import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { FunctionCallingConfigMode, Type, type FunctionDeclaration } from "@google/genai";
import { startTestServer, stopTestServer, VALID_API_KEY, type TestContext } from "./setup";

const MODEL = "gemini-3.6-flash";

const WEATHER: FunctionDeclaration = {
  name: "get_weather",
  description: "Get the weather for a city",
  parameters: {
    type: Type.OBJECT,
    properties: {
      city: { type: Type.STRING },
      unit: { type: Type.STRING, enum: ["celsius", "fahrenheit"] },
    },
    required: ["city", "unit"],
  },
};

const TOOLS = [{ functionDeclarations: [WEATHER] }];

describe("gemini tool calls", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestServer();
  });
  afterAll(() => stopTestServer(ctx));

  const post = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${ctx.baseUrl}/v1beta/models/${MODEL}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": VALID_API_KEY, "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });

  it("answers with prose when the mode is AUTO, having no model to decide", async () => {
    const response = await ctx.client.models.generateContent({
      model: MODEL,
      contents: "weather in Valencia?",
      config: { tools: TOOLS, toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } } },
    });

    expect(response.functionCalls).toBeUndefined();
    expect(response.text).toBe("Echo: weather in Valencia?");
  });

  it("forces a call when the mode is ANY", async () => {
    const response = await ctx.client.models.generateContent({
      model: MODEL,
      contents: "weather in Valencia?",
      config: { tools: TOOLS, toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY } } },
    });

    expect(response.functionCalls).toHaveLength(1);
    expect(response.functionCalls?.[0]?.name).toBe("get_weather");
  });

  it("synthesizes arguments from the declaration's schema", async () => {
    const response = await ctx.client.models.generateContent({
      model: MODEL,
      contents: "weather?",
      config: { tools: TOOLS, toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY } } },
    });

    // Gemini spells schema types in uppercase; a placeholder per required
    // property, and the first enum value where the schema constrains it.
    expect(response.functionCalls?.[0]?.args).toEqual({ city: "mock", unit: "celsius" });
  });

  it("obeys allowedFunctionNames", async () => {
    const search: FunctionDeclaration = { name: "search", parameters: { type: Type.OBJECT, properties: {} } };
    const response = await ctx.client.models.generateContent({
      model: MODEL,
      contents: "anything",
      config: {
        tools: [{ functionDeclarations: [WEATHER, search] }],
        toolConfig: {
          functionCallingConfig: {
            mode: FunctionCallingConfigMode.ANY,
            allowedFunctionNames: ["search"],
          },
        },
      },
    });

    expect(response.functionCalls?.[0]?.name).toBe("search");
  });

  it("never calls a tool when the mode is NONE", async () => {
    const response = await ctx.client.models.generateContent({
      model: MODEL,
      contents: "weather?",
      config: { tools: TOOLS, toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.NONE } } },
    });

    expect(response.functionCalls).toBeUndefined();
    expect(response.text).toBe("Echo: weather?");
  });

  it("carries the call as a part, with args decoded rather than JSON-encoded", async () => {
    const res = await post({
      contents: [{ role: "user", parts: [{ text: "weather?" }] }],
      tools: TOOLS,
      toolConfig: { functionCallingConfig: { mode: "ANY" } },
    });
    const body = (await res.json()) as {
      candidates: { content: { parts: { functionCall?: { name: string; args: unknown } }[] } }[];
    };
    const call = body.candidates[0]?.content.parts[0]?.functionCall;

    expect(call?.name).toBe("get_weather");
    expect(typeof call?.args).toBe("object");
  });

  it("terminates the loop once a functionResponse is in the conversation", async () => {
    const response = await ctx.client.models.generateContent({
      model: MODEL,
      contents: [
        { role: "user", parts: [{ text: "weather in Valencia?" }] },
        { role: "model", parts: [{ functionCall: { name: "get_weather", args: { city: "Valencia" } } }] },
        { role: "user", parts: [{ functionResponse: { name: "get_weather", response: { temp: 30 } } }] },
      ],
      config: { tools: TOOLS, toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY } } },
    });

    expect(response.functionCalls).toBeUndefined();
    // The prompt is still echoed: a functionResponse turn also carries the user
    // role in Gemini, and skipping it is what keeps the original text in view.
    expect(response.text).toBe("Echo: weather in Valencia?");
  });

  it("pins exact calls with the x-llm-mock-tool-calls header", async () => {
    const res = await post(
      { contents: [{ role: "user", parts: [{ text: "weather?" }] }], tools: TOOLS },
      { "x-llm-mock-tool-calls": JSON.stringify([{ name: "get_weather", arguments: { city: "Valencia" } }]) },
    );
    const body = (await res.json()) as {
      candidates: { content: { parts: { functionCall?: { name: string; args: unknown } }[] } }[];
    };

    expect(body.candidates[0]?.content.parts[0]?.functionCall).toEqual({
      name: "get_weather",
      args: { city: "Valencia" },
    });
  });

  it("streams a function call as one whole part", async () => {
    const stream = await ctx.client.models.generateContentStream({
      model: MODEL,
      contents: "weather?",
      config: { tools: TOOLS, toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY } } },
    });

    const calls = [];
    for await (const chunk of stream) calls.push(...(chunk.functionCalls ?? []));

    // Unlike OpenAI, Gemini does not split a call's arguments across deltas.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual({ city: "mock", unit: "celsius" });
  });
});
