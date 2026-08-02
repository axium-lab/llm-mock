import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { API_VERSION, startTestServer, stopTestServer, VALID_API_KEY, type TestContext } from "./setup";

interface FilterVerdict {
  filtered: boolean;
  severity?: string;
  detected?: boolean;
}

interface Completion {
  choices: {
    message: { content: string | null };
    finish_reason: string;
    content_filter_results: Record<string, FilterVerdict | { code: string; message: string }>;
  }[];
  prompt_filter_results: { prompt_index: number; content_filter_results: Record<string, FilterVerdict> }[];
}

describe("azure content filtering", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestServer();
  });
  afterAll(() => stopTestServer(ctx));

  const chat = (filter?: string, extra: Record<string, unknown> = {}) =>
    fetch(`${ctx.baseUrl}/deployments/d/chat/completions?api-version=${API_VERSION}`, {
      method: "POST",
      headers: {
        "api-key": VALID_API_KEY,
        "content-type": "application/json",
        ...(filter ? { "x-llm-mock-content-filter": filter } : {}),
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [{ role: "user", content: "hello there" }],
        ...extra,
      }),
    });

  it("annotates every response, even when nothing is flagged", async () => {
    const body = (await chat().then((r) => r.json())) as Completion;

    // One entry per prompt, keyed by index, with the verdict nested inside.
    expect(body.prompt_filter_results).toHaveLength(1);
    expect(body.prompt_filter_results[0]?.prompt_index).toBe(0);
    expect(body.prompt_filter_results[0]?.content_filter_results.hate).toEqual({
      filtered: false,
      severity: "safe",
    });

    // And a verdict on each choice, sibling to `message`.
    expect(body.choices[0]?.content_filter_results.violence).toEqual({ filtered: false, severity: "safe" });
  });

  it("reports the prompt's binary detectors, absent from the choice's verdict", async () => {
    const body = (await chat().then((r) => r.json())) as Completion;

    // jailbreak is an input-side signal: detected/filtered, no severity.
    expect(body.prompt_filter_results[0]?.content_filter_results.jailbreak).toEqual({
      filtered: false,
      detected: false,
    });
    expect(body.choices[0]?.content_filter_results.jailbreak).toBeUndefined();
  });

  describe("a blocked prompt", () => {
    it("fails the call outright with a 400", async () => {
      const res = await chat("prompt");
      expect(res.status).toBe(400);

      const body = (await res.json()) as {
        error: { code: string; param: string; type: null; status: number };
      };
      expect(body.error.code).toBe("content_filter");
      expect(body.error.param).toBe("prompt");
      // Azure repeats the status inside the error object, which OpenAI never does.
      expect(body.error.type).toBeNull();
      expect(body.error.status).toBe(400);
    });

    it("carries the verdict that caused the block in innererror", async () => {
      const res = await chat("prompt:self_harm:medium");
      const body = (await res.json()) as {
        error: { innererror: { code: string; content_filter_result: Record<string, FilterVerdict> } };
      };

      expect(body.error.innererror.code).toBe("ResponsibleAIPolicyViolation");
      // Singular `content_filter_result` here, against the plural used
      // everywhere else — the service's own inconsistency.
      expect(body.error.innererror.content_filter_result.self_harm).toEqual({
        filtered: true,
        severity: "medium",
      });
      expect(body.error.innererror.content_filter_result.hate).toEqual({
        filtered: false,
        severity: "safe",
      });
    });
  });

  describe("a filtered completion", () => {
    it("succeeds with no content and says why", async () => {
      const body = (await chat("completion:violence:high").then((r) => r.json())) as Completion;
      const choice = body.choices[0];

      expect(choice?.finish_reason).toBe("content_filter");
      expect(choice?.message.content).toBeNull();
      expect(choice?.content_filter_results.violence).toEqual({ filtered: true, severity: "high" });
    });

    it("says nothing about the prompt, which passed", async () => {
      const body = (await chat("completion:violence:high").then((r) => r.json())) as Completion;
      const prompt = body.prompt_filter_results[0]?.content_filter_results;

      expect(prompt?.violence).toEqual({ filtered: false, severity: "safe" });
    });

    it("cuts the stream short and marks the last chunk", async () => {
      const res = await chat("completion", { stream: true });
      const chunks = (await res.text())
        .split("\n\n")
        .filter((line) => line.startsWith("data: ") && !line.includes("[DONE]"))
        .map((line) => JSON.parse(line.replace("data: ", "")) as { choices: { finish_reason: string | null }[] });

      const reasons = chunks.flatMap((chunk) => chunk.choices.map((choice) => choice.finish_reason));
      expect(reasons.at(-1)).toBe("content_filter");
    });
  });

  it("reports an unavailable filter as an error object where the verdict would be", async () => {
    const body = (await chat("unavailable").then((r) => r.json())) as Completion;

    // Clients are told to check for this rather than assume the filter ran.
    expect(body.choices[0]?.content_filter_results).toEqual({
      error: { code: "content_filter_error", message: "The contents are not filtered" },
    });
  });

  describe("streaming", () => {
    it("opens with a chunk carrying no choices at all", async () => {
      const res = await chat(undefined, { stream: true });
      const chunks = (await res.text())
        .split("\n\n")
        .filter((line) => line.startsWith("data: ") && !line.includes("[DONE]"))
        .map((line) => JSON.parse(line.replace("data: ", "")) as { choices: unknown[]; prompt_filter_results?: unknown });

      // A client reaching straight for choices[0] breaks here — which is
      // exactly the bug this reproduction lets you catch.
      expect(chunks[0]?.choices).toEqual([]);
      expect(chunks[0]?.prompt_filter_results).toBeDefined();
    });

    it("stays readable by the official SDK despite that first chunk", async () => {
      const stream = await ctx.classic.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: "stream this please" }],
        stream: true,
      });

      let text = "";
      for await (const chunk of stream) text += chunk.choices[0]?.delta.content ?? "";
      expect(text).toBe("Echo: stream this please");
    });
  });

  it("rejects a malformed filter header", async () => {
    for (const value of ["nonsense", "prompt:not_a_category", "prompt:hate:extreme"]) {
      const res = await chat(value);
      expect(res.status).toBe(400);

      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("BadRequest");
    }
  });

  it("leaves embeddings unannotated, having no generated content to judge", async () => {
    const res = await fetch(`${ctx.baseUrl}/deployments/d/embeddings?api-version=${API_VERSION}`, {
      method: "POST",
      headers: { "api-key": VALID_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({ model: "text-embedding-3-small", input: "hi" }),
    });
    const body = (await res.json()) as Record<string, unknown>;

    expect(body.prompt_filter_results).toBeUndefined();
  });
});
