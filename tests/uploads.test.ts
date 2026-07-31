import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { NotFoundError } from "openai";
import { startTestServer, stopTestServer, VALID_API_KEY, type TestContext } from "./setup";

interface ErrorBody {
  error: { message: string; type: string; param: string | null; code: string | null };
}

const CREATE_PARAMS = {
  filename: "training-examples.jsonl",
  bytes: 2048,
  mime_type: "text/jsonl",
  purpose: "fine-tune",
} as const;

describe("uploads", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestServer();
  });
  afterAll(() => stopTestServer(ctx));

  it("creates a pending upload", async () => {
    const upload = await ctx.client.uploads.create(CREATE_PARAMS);
    expect(upload.object).toBe("upload");
    expect(upload.id).toStartWith("upload_");
    expect(upload.status).toBe("pending");
    expect(upload.filename).toBe(CREATE_PARAMS.filename);
    expect(upload.bytes).toBe(CREATE_PARAMS.bytes);
    expect(upload.purpose).toBe(CREATE_PARAMS.purpose);
    expect(upload.expires_at).toBe(upload.created_at + 3600);
    expect(upload.file).toBeNull();
  });

  it("adds parts and completes the upload into a file object", async () => {
    const upload = await ctx.client.uploads.create(CREATE_PARAMS);
    const first = await ctx.client.uploads.parts.create(upload.id, { data: new Blob(["part one"]) });
    const second = await ctx.client.uploads.parts.create(upload.id, { data: new Blob(["part two"]) });

    expect(first.object).toBe("upload.part");
    expect(first.id).toStartWith("part_");
    expect(first.upload_id).toBe(upload.id);
    expect(second.id).not.toBe(first.id);

    const completed = await ctx.client.uploads.complete(upload.id, { part_ids: [first.id, second.id] });
    expect(completed.status).toBe("completed");
    expect(completed.id).toBe(upload.id);
    // The upload's metadata survives the round-trip even though nothing is stored.
    expect(completed.filename).toBe(CREATE_PARAMS.filename);
    expect(completed.file?.id).toStartWith("file-");
    expect(completed.file?.filename).toBe(CREATE_PARAMS.filename);
    expect(completed.file?.bytes).toBe(CREATE_PARAMS.bytes);
    expect(completed.file?.purpose).toBe(CREATE_PARAMS.purpose);
  });

  it("makes the completed file retrievable through the files API", async () => {
    const upload = await ctx.client.uploads.create(CREATE_PARAMS);
    const part = await ctx.client.uploads.parts.create(upload.id, { data: new Blob(["data"]) });
    const completed = await ctx.client.uploads.complete(upload.id, { part_ids: [part.id] });

    const file = await ctx.client.files.retrieve(completed.file?.id ?? "");
    expect(file).toEqual(completed.file!);
  });

  it("accepts the optional md5 checksum", async () => {
    const upload = await ctx.client.uploads.create(CREATE_PARAMS);
    const part = await ctx.client.uploads.parts.create(upload.id, { data: new Blob(["data"]) });
    const completed = await ctx.client.uploads.complete(upload.id, {
      part_ids: [part.id],
      md5: "9a0364b9e99bb480dd25e1f0284c8555",
    });
    expect(completed.status).toBe("completed");
  });

  it("cancels an upload", async () => {
    const upload = await ctx.client.uploads.create(CREATE_PARAMS);
    const cancelled = await ctx.client.uploads.cancel(upload.id);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.file).toBeNull();
  });

  it("is deterministic: identical create calls yield the same upload id", async () => {
    const first = await ctx.client.uploads.create(CREATE_PARAMS);
    const second = await ctx.client.uploads.create(CREATE_PARAMS);
    expect(second.id).toBe(first.id);
  });

  it("rejects a create call with a missing field", async () => {
    const res = await fetch(`${ctx.baseURL}/uploads`, {
      method: "POST",
      headers: { Authorization: `Bearer ${VALID_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ bytes: 10, mime_type: "text/plain", purpose: "assistants" }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorBody).error.param).toBe("filename");
  });

  it("rejects a create call with a non-integer bytes value", async () => {
    const res = await fetch(`${ctx.baseURL}/uploads`, {
      method: "POST",
      headers: { Authorization: `Bearer ${VALID_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...CREATE_PARAMS, bytes: "many" }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorBody).error.param).toBe("bytes");
  });

  it("rejects completing without part_ids", async () => {
    const upload = await ctx.client.uploads.create(CREATE_PARAMS);
    const res = await fetch(`${ctx.baseURL}/uploads/${upload.id}/complete`, {
      method: "POST",
      headers: { Authorization: `Bearer ${VALID_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ part_ids: [] }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorBody).error.param).toBe("part_ids");
  });

  it("reports the reserved upload_missing prefix as a 404", async () => {
    try {
      await ctx.client.uploads.cancel("upload_missing_123");
      throw new Error("expected the request to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundError);
      expect((error as NotFoundError).message).toContain("No such Upload object");
    }
  });

  it("requires authentication", async () => {
    const res = await fetch(`${ctx.baseURL}/uploads`, { method: "POST" });
    expect(res.status).toBe(401);
  });
});
