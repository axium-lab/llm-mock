import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type Anthropic from "@anthropic-ai/sdk";
import { headers, startTestServer, stopTestServer, type TestContext } from "./setup";

const MODEL = "claude-opus-5";

const REQUESTS: Anthropic.Messages.Batches.BatchCreateParams["requests"] = [
  { custom_id: "first", params: { model: MODEL, max_tokens: 64, messages: [{ role: "user", content: "one" }] } },
  { custom_id: "second", params: { model: MODEL, max_tokens: 64, messages: [{ role: "user", content: "two" }] } },
];

describe("anthropic message batches", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestServer();
  });
  afterAll(() => stopTestServer(ctx));

  const post = (body: unknown, extra: Record<string, string> = {}) =>
    fetch(`${ctx.baseURL}/v1/messages/batches`, {
      method: "POST",
      headers: { ...headers(), "content-type": "application/json", ...extra },
      body: JSON.stringify(body),
    });

  it("creates a batch that reports every request as succeeded", async () => {
    const batch = await ctx.client.messages.batches.create({ requests: REQUESTS });

    expect(batch.type).toBe("message_batch");
    expect(batch.id.startsWith("msgbatch_")).toBe(true);
    expect(batch.processing_status).toBe("ended");
    expect(batch.request_counts).toEqual({
      processing: 0,
      succeeded: 2,
      errored: 0,
      canceled: 0,
      expired: 0,
    });
    expect(batch.ended_at).not.toBeNull();
    expect(batch.cancel_initiated_at).toBeNull();
    expect(batch.archived_at).toBeNull();
    expect(batch.results_url).toContain(`${batch.id}/results`);
  });

  it("expires 29 days after it was created", async () => {
    const batch = await ctx.client.messages.batches.create({ requests: REQUESTS });
    const lifetime = Date.parse(batch.expires_at) - Date.parse(batch.created_at);
    expect(lifetime).toBe(29 * 24 * 60 * 60 * 1000);
  });

  it("retrieves the batch back from its id", async () => {
    const created = await ctx.client.messages.batches.create({ requests: REQUESTS });
    const retrieved = await ctx.client.messages.batches.retrieve(created.id);
    expect(retrieved).toEqual(created);
  });

  it("streams one result per request, keyed by custom_id", async () => {
    const batch = await ctx.client.messages.batches.create({ requests: REQUESTS });

    const results: Anthropic.Messages.Batches.MessageBatchIndividualResponse[] = [];
    for await (const result of await ctx.client.messages.batches.results(batch.id)) {
      results.push(result);
    }

    expect(results.map((result) => result.custom_id)).toEqual(["first", "second"]);
    for (const result of results) {
      expect(result.result.type).toBe("succeeded");
      if (result.result.type !== "succeeded") continue;
      expect(result.result.message.type).toBe("message");
      expect(result.result.message.model).toBe(MODEL);
    }

    const [one, two] = results;
    if (one?.result.type !== "succeeded" || two?.result.type !== "succeeded") throw new Error("expected successes");
    expect((one.result.message.content[0] as Anthropic.TextBlock).text).toContain("one");
    expect((two.result.message.content[0] as Anthropic.TextBlock).text).toContain("two");
  });

  it("serves the results as JSONL", async () => {
    const batch = await ctx.client.messages.batches.create({ requests: REQUESTS });
    const response = await fetch(`${ctx.baseURL}/v1/messages/batches/${batch.id}/results`, { headers: headers() });

    expect(response.headers.get("content-type")).toContain("application/x-jsonl");
    const lines = (await response.text()).split("\n");
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
  });

  it("cancels a batch into the canceling status", async () => {
    const batch = await ctx.client.messages.batches.create({ requests: REQUESTS });
    const canceled = await ctx.client.messages.batches.cancel(batch.id);

    expect(canceled.id).toBe(batch.id);
    expect(canceled.processing_status).toBe("canceling");
    expect(canceled.cancel_initiated_at).not.toBeNull();
    expect(canceled.results_url).toBeNull();
  });

  it("deletes a batch", async () => {
    const batch = await ctx.client.messages.batches.create({ requests: REQUESTS });
    const deleted = await ctx.client.messages.batches.delete(batch.id);
    expect(deleted).toEqual({ id: batch.id, type: "message_batch_deleted" });
  });

  it("lists nothing, because the mock keeps no batches", async () => {
    const page = await ctx.client.messages.batches.list();
    expect(page.data).toEqual([]);
    expect(page.has_more).toBe(false);
  });

  it("pins the processing status from the mock header", async () => {
    const response = await post({ requests: REQUESTS }, { "x-llm-mock-batch-status": "in_progress" });
    const batch = (await response.json()) as Anthropic.Messages.Batches.MessageBatch;

    expect(batch.processing_status).toBe("in_progress");
    expect(batch.request_counts.processing).toBe(2);
    expect(batch.request_counts.succeeded).toBe(0);
    expect(batch.ended_at).toBeNull();
    // Nothing to read yet, so no URL to read it from.
    expect(batch.results_url).toBeNull();
  });

  it("refuses to serve the results of a batch that has not ended", async () => {
    const created = await post({ requests: REQUESTS }, { "x-llm-mock-batch-status": "in_progress" });
    const { id } = (await created.json()) as { id: string };

    const response = await fetch(`${ctx.baseURL}/v1/messages/batches/${id}/results`, { headers: headers() });
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/json");
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toContain("in_progress");
  });

  it("rejects an unknown mock status", async () => {
    const response = await post({ requests: REQUESTS }, { "x-llm-mock-batch-status": "finished" });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toContain("x-llm-mock-batch-status");
  });

  it("rejects an empty list of requests", async () => {
    const response = await post({ requests: [] });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { type: string; message: string } };
    expect(body.error.type).toBe("invalid_request_error");
    expect(body.error.message).toContain("requests");
  });

  it("rejects a duplicated custom_id", async () => {
    const response = await post({ requests: [REQUESTS[0], REQUESTS[0]] });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toContain("duplicated");
  });

  it("rejects a request without a custom_id", async () => {
    const response = await post({ requests: [{ params: REQUESTS[0]?.params }] });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toContain("requests.0.custom_id");
  });

  it("rejects a request whose params carry no model", async () => {
    const response = await post({
      requests: [{ custom_id: "x", params: { max_tokens: 8, messages: [{ role: "user", content: "hi" }] } }],
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toContain("requests.0.params.model");
  });

  it("says so when a batch no longer fits in its own id", async () => {
    const many = Array.from({ length: 60 }, (_, index) => ({
      custom_id: `req-${index}`,
      params: { model: MODEL, max_tokens: 8, messages: [{ role: "user", content: `prompt number ${index}` }] },
    }));

    const response = await post({ requests: many });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toContain("stateless");
  });

  it("404s on an id that decodes to nothing", async () => {
    const response = await fetch(`${ctx.baseURL}/v1/messages/batches/msgbatch_nope`, { headers: headers() });
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { type: string } };
    expect(body.error.type).toBe("not_found_error");
  });

  it("returns the same bytes for the same batch", async () => {
    const body = { requests: REQUESTS };
    const [a, b] = await Promise.all([post(body).then((r) => r.text()), post(body).then((r) => r.text())]);
    expect(a).toBe(b);
  });
});
