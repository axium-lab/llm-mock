import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { API_VERSION, startTestServer, stopTestServer, VALID_API_KEY, type TestContext } from "./setup";

const DEPLOYMENT = "gpt-35-turbo-instruct";

interface AnnotatedCompletion {
  object: string;
  choices: { text: string; finish_reason: string; content_filter_results: Record<string, unknown> }[];
  prompt_filter_results: { prompt_index: number }[];
}

// The legacy completions endpoint, deployment-scoped on the classic surface
// and addressed by model on v1, with the filter's verdict attached like on
// chat completions.
describe("azure completions", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestServer();
  });
  afterAll(() => stopTestServer(ctx));

  const classicPath = `/deployments/${DEPLOYMENT}/completions?api-version=${API_VERSION}`;

  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${ctx.baseUrl}${path}`, {
      method: "POST",
      headers: { "api-key": VALID_API_KEY, "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });

  it("answers through the SDK on the classic surface", async () => {
    const completion = await ctx.classic.completions.create({ model: DEPLOYMENT, prompt: "Say hi" });

    expect(completion.object).toBe("text_completion");
    expect(completion.id).toStartWith("cmpl-");
    expect(completion.choices[0]?.text).toBe("Echo: Say hi");
    expect(completion.choices[0]?.finish_reason).toBe("stop");
  });

  it("answers through a plain OpenAI client on the v1 surface", async () => {
    const completion = await ctx.v1.completions.create({ model: DEPLOYMENT, prompt: "Say hi" });
    expect(completion.choices[0]?.text).toBe("Echo: Say hi");
  });

  it("annotates the response with the filter's verdict", async () => {
    const body = (await post(classicPath, { model: DEPLOYMENT, prompt: "hi" }).then((r) => r.json())) as AnnotatedCompletion;

    expect(body.prompt_filter_results[0]?.prompt_index).toBe(0);
    expect(body.choices[0]?.content_filter_results.hate).toEqual({ filtered: false, severity: "safe" });
  });

  it("cuts a filtered reply to empty text", async () => {
    const body = (await post(classicPath, { model: DEPLOYMENT, prompt: "hi" }, { "x-llm-mock-content-filter": "completion" }).then(
      (r) => r.json(),
    )) as AnnotatedCompletion;

    expect(body.choices[0]?.text).toBe("");
    expect(body.choices[0]?.finish_reason).toBe("content_filter");
  });

  it("fails a blocked prompt outright", async () => {
    const res = await post(classicPath, { model: DEPLOYMENT, prompt: "hi" }, { "x-llm-mock-content-filter": "prompt" });
    expect(res.status).toBe(400);

    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("content_filter");
  });

  it("streams, opening with the empty verdict chunk and closing with [DONE]", async () => {
    const stream = await ctx.classic.completions.create({ model: DEPLOYMENT, prompt: "stream this please", stream: true });
    let text = "";
    for await (const chunk of stream) text += chunk.choices[0]?.text ?? "";
    expect(text).toBe("Echo: stream this please");

    const frames = (await post(classicPath, { model: DEPLOYMENT, prompt: "x", stream: true }).then((r) => r.text()))
      .split("\n\n")
      .filter(Boolean);
    const first = JSON.parse(frames[0]!.replace("data: ", "")) as AnnotatedCompletion;
    expect(first.choices).toEqual([]);
    expect(first.prompt_filter_results).toHaveLength(1);
    expect(frames[frames.length - 1]).toBe("data: [DONE]");
  });

  it("reports a reserved deployment name as DeploymentNotFound", async () => {
    const res = await post(`/deployments/missing-one/completions?api-version=${API_VERSION}`, {
      model: DEPLOYMENT,
      prompt: "hi",
    });
    expect(res.status).toBe(404);

    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("DeploymentNotFound");
  });
});
