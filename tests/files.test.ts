import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { NotFoundError, toFile } from "openai";
import { startTestServer, stopTestServer, VALID_API_KEY, type TestContext } from "./setup";

interface ErrorBody {
  error: { message: string; type: string; param: string | null; code: string | null };
}

const sample = (text = '{"prompt":"hi"}\n', name = "training.jsonl") => toFile(Buffer.from(text), name);

describe("files", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestServer();
  });
  afterAll(() => stopTestServer(ctx));

  it("uploads a file and echoes back its metadata", async () => {
    const file = await ctx.client.files.create({ file: await sample(), purpose: "fine-tune" });
    expect(file.object).toBe("file");
    expect(file.id).toStartWith("file-");
    expect(file.filename).toBe("training.jsonl");
    expect(file.bytes).toBe(16);
    expect(file.purpose).toBe("fine-tune");
    expect(file.created_at).toBeGreaterThan(0);
  });

  it("round-trips an uploaded file through retrieve without server state", async () => {
    const created = await ctx.client.files.create({
      file: await sample("hello there\n", "notes.txt"),
      purpose: "assistants",
    });
    const retrieved = await ctx.client.files.retrieve(created.id);
    expect(retrieved).toEqual(created);
  });

  it("is deterministic: the same bytes and filename yield the same id", async () => {
    const first = await ctx.client.files.create({ file: await sample(), purpose: "fine-tune" });
    const second = await ctx.client.files.create({ file: await sample(), purpose: "fine-tune" });
    expect(second.id).toBe(first.id);
  });

  it("changes the id when the purpose changes", async () => {
    const fineTune = await ctx.client.files.create({ file: await sample(), purpose: "fine-tune" });
    const assistants = await ctx.client.files.create({ file: await sample(), purpose: "assistants" });
    expect(assistants.id).not.toBe(fineTune.id);
  });

  it("accepts a nameless Blob, which is what a sliced chunk looks like on the wire", async () => {
    const file = await ctx.client.files.create({ file: new Blob(["sliced bytes"]), purpose: "assistants" });
    expect(file.bytes).toBe(12);
    expect(file.filename).toBe("upload");
  });

  it("honors expires_after", async () => {
    const file = await ctx.client.files.create({
      file: await sample(),
      purpose: "batch",
      expires_after: { anchor: "created_at", seconds: 7200 },
    });
    expect(file.expires_at).toBe(file.created_at + 7200);
  });

  it("rejects a purpose the API does not accept", async () => {
    const res = await fetch(`${ctx.baseURL}/files`, {
      method: "POST",
      headers: { Authorization: `Bearer ${VALID_API_KEY}` },
      body: (() => {
        const form = new FormData();
        form.set("file", new Blob(["x"]), "x.txt");
        form.set("purpose", "not-a-purpose");
        return form;
      })(),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.param).toBe("purpose");
    expect(body.error.message).toContain("'fine-tune'");
  });

  it("rejects an upload with no file part", async () => {
    const res = await fetch(`${ctx.baseURL}/files`, {
      method: "POST",
      headers: { Authorization: `Bearer ${VALID_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ purpose: "assistants" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.param).toBe("file");
  });

  it("lists the simulated catalog newest first", async () => {
    const page = await ctx.client.files.list();
    expect(page.data.length).toBeGreaterThan(1);
    expect(page.has_more).toBe(false);
    const timestamps = page.data.map((file) => file.created_at);
    expect([...timestamps].sort((a, b) => b - a)).toEqual(timestamps);
  });

  it("filters the listing by purpose", async () => {
    const page = await ctx.client.files.list({ purpose: "fine-tune" });
    expect(page.data.length).toBeGreaterThan(0);
    expect(page.data.every((file) => file.purpose === "fine-tune")).toBe(true);
  });

  it("paginates with limit and after", async () => {
    const first = await ctx.client.files.list({ limit: 2, order: "asc" });
    expect(first.data).toHaveLength(2);
    expect(first.has_more).toBe(true);

    const second = await ctx.client.files.list({ limit: 2, order: "asc", after: first.data[1]?.id });
    expect(second.data).toHaveLength(2);
    expect(second.data.map((file) => file.id)).not.toEqual(first.data.map((file) => file.id));
  });

  it("rejects an out-of-range limit", async () => {
    const res = await fetch(`${ctx.baseURL}/files?limit=0`, {
      headers: { Authorization: `Bearer ${VALID_API_KEY}` },
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorBody).error.param).toBe("limit");
  });

  it("returns the placeholder content of a catalog file", async () => {
    const content = await ctx.client.files.content("file-mock-training-jsonl");
    const text = await content.text();
    expect(text.split("\n")[0]).toStartWith('{"messages"');
    // Deterministic: the same file always yields the same bytes.
    expect(await (await ctx.client.files.content("file-mock-training-jsonl")).text()).toBe(text);
  });

  it("serves canned content from the x-llm-mock-response header", async () => {
    const content = await ctx.client.files.content("file-mock-manual-pdf", {
      headers: { "x-llm-mock-response": "pinned bytes" },
    });
    expect(await content.text()).toBe("pinned bytes");
  });

  it("deletes a file", async () => {
    const created = await ctx.client.files.create({ file: await sample(), purpose: "assistants" });
    const deleted = await ctx.client.files.delete(created.id);
    expect(deleted).toEqual({ id: created.id, object: "file", deleted: true });
  });

  it("reports the reserved file-missing prefix as a 404", async () => {
    try {
      await ctx.client.files.retrieve("file-missing-123");
      throw new Error("expected the request to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundError);
      const notFound = error as NotFoundError;
      expect(notFound.status).toBe(404);
      expect(notFound.message).toContain("No such File object");
    }
  });

  it("rejects an id that is not a file id", async () => {
    const res = await fetch(`${ctx.baseURL}/files/not-a-file-id`, {
      headers: { Authorization: `Bearer ${VALID_API_KEY}` },
    });
    expect(res.status).toBe(404);
  });

  it("requires authentication", async () => {
    const res = await fetch(`${ctx.baseURL}/files`);
    expect(res.status).toBe(401);
  });
});
