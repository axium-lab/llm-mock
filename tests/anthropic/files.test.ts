import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { toFile } from "@anthropic-ai/sdk";
import { headers, startTestServer, stopTestServer, type TestContext } from "./setup";

const FILES_BETA = "files-api-2025-04-14";

// A file the mock catalog reports as produced by the API, and therefore the
// only kind that can be read back.
const DOWNLOADABLE = "file_mock_container_output_txt";

const upload = (ctx: TestContext, name = "notes.txt", body = "hello from llm-mock\n", type = "text/plain") =>
  toFile(Buffer.from(body), name, { type }).then((file) => ctx.client.beta.files.upload({ file }));

describe("anthropic files", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestServer();
  });
  afterAll(() => stopTestServer(ctx));

  const get = (path: string, betas: string[] = [FILES_BETA], extra: Record<string, string> = {}) => {
    const merged = new Headers({ ...headers(), ...extra });
    for (const beta of betas) merged.append("anthropic-beta", beta);
    return fetch(`${ctx.baseURL}${path}`, { headers: merged });
  };

  it("uploads a file and reports its metadata", async () => {
    const file = await upload(ctx);

    expect(file.type).toBe("file");
    expect(file.id.startsWith("file_")).toBe(true);
    expect(file.filename).toBe("notes.txt");
    expect(file.size_bytes).toBe(20);
    // The SDK's own helper appends a charset; the API reports the bare type.
    expect(file.mime_type).toBe("text/plain");
    expect(file.downloadable).toBe(false);
    expect(Date.parse(file.created_at)).not.toBeNaN();
  });

  it("falls back to the extension when the client declares no type", async () => {
    const file = await ctx.client.beta.files.upload({
      file: await toFile(Buffer.from("%PDF-1.7\n"), "manual.pdf"),
    });
    expect(file.mime_type).toBe("application/pdf");
  });

  it("mints the same id for the same bytes and name", async () => {
    const [a, b] = await Promise.all([upload(ctx), upload(ctx)]);
    expect(a.id).toBe(b.id);
    expect(a).toEqual(b);
  });

  it("mints a different id when the bytes change", async () => {
    const a = await upload(ctx, "notes.txt", "one");
    const b = await upload(ctx, "notes.txt", "two");
    expect(a.id).not.toBe(b.id);
  });

  it("retrieves an uploaded file back from its id alone", async () => {
    const uploaded = await upload(ctx);
    const retrieved = await ctx.client.beta.files.retrieveMetadata(uploaded.id);
    expect(retrieved).toEqual(uploaded);
  });

  it("lists the simulated catalog", async () => {
    const page = await ctx.client.beta.files.list();
    expect(page.data.length).toBeGreaterThan(0);
    for (const file of page.data) expect(file.type).toBe("file");
    expect(page.first_id).toBe(page.data[0]!.id);
    expect(page.last_id).toBe(page.data[page.data.length - 1]!.id);
  });

  it("paginates by id cursor", async () => {
    const first = await ctx.client.beta.files.list({ limit: 2 });
    expect(first.data).toHaveLength(2);
    expect(first.has_more).toBe(true);

    const second = await ctx.client.beta.files.list({ limit: 2, after_id: first.last_id ?? undefined });
    expect(second.data[0]!.id).not.toBe(first.data[0]!.id);
    expect(second.data.map((file) => file.id)).not.toContain(first.last_id);
  });

  it("filters by scope_id", async () => {
    const response = await get("/v1/files?scope_id=session_mock_01");
    const page = (await response.json()) as { data: { scope?: { id: string } }[] };
    expect(page.data.length).toBeGreaterThan(0);
    for (const file of page.data) expect(file.scope?.id).toBe("session_mock_01");
  });

  it("rejects an out-of-range limit", async () => {
    const response = await get("/v1/files?limit=0");
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { type: string; message: string } };
    expect(body.error.type).toBe("invalid_request_error");
    expect(body.error.message).toContain("limit");
  });

  it("downloads a file the API produced itself", async () => {
    const response = await ctx.client.beta.files.download(DOWNLOADABLE);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(await response.text()).toContain("output.txt");
  });

  it("pins the downloaded bytes with the mock header", async () => {
    const response = await get(`/v1/files/${DOWNLOADABLE}/content`, [FILES_BETA], {
      "x-llm-mock-response": "pinned bytes",
    });
    expect(await response.text()).toBe("pinned bytes");
  });

  it("refuses to download a file that was uploaded", async () => {
    const uploaded = await upload(ctx);
    try {
      await ctx.client.beta.files.download(uploaded.id);
      throw new Error("expected the download to fail");
    } catch (error) {
      const status = (error as { status?: number }).status;
      expect(status).toBe(403);
      expect(String((error as Error).message)).toContain("permission_error");
    }
  });

  it("deletes a file", async () => {
    const uploaded = await upload(ctx);
    const deleted = await ctx.client.beta.files.delete(uploaded.id);
    expect(deleted).toEqual({ id: uploaded.id, type: "file_deleted" });
  });

  it("404s on the reserved missing prefix", async () => {
    try {
      await ctx.client.beta.files.retrieveMetadata("file_missing_one");
      throw new Error("expected a 404");
    } catch (error) {
      expect((error as { status?: number }).status).toBe(404);
      expect(String((error as Error).message)).toContain("not_found_error");
    }
  });

  it("404s on an id that is not a file id at all", async () => {
    const response = await get("/v1/files/not-a-file-id");
    expect(response.status).toBe(404);
  });

  it("synthesizes a plausible file for a foreign id", async () => {
    const file = await ctx.client.beta.files.retrieveMetadata("file_011CNha8iCJcU1wXNR6q4V8w");
    expect(file.id).toBe("file_011CNha8iCJcU1wXNR6q4V8w");
    expect(file.size_bytes).toBeGreaterThan(0);
    expect(file.filename).toBeTruthy();
  });

  describe("beta gating", () => {
    it("rejects a call without the anthropic-beta header", async () => {
      const response = await get("/v1/files", []);
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: { type: string; message: string } };
      expect(body.error.type).toBe("invalid_request_error");
      expect(body.error.message).toContain(FILES_BETA);
    });

    it("rejects a call that opts into some other beta", async () => {
      const response = await get("/v1/files", ["context-1m-2025-08-07"]);
      expect(response.status).toBe(400);
    });

    it("accepts the flag alongside others, comma-separated", async () => {
      const response = await get("/v1/files", [`context-1m-2025-08-07,${FILES_BETA}`]);
      expect(response.status).toBe(200);
    });

    it("accepts the header repeated rather than joined", async () => {
      const response = await get("/v1/files", ["context-1m-2025-08-07", FILES_BETA]);
      expect(response.status).toBe(200);
    });

    it("does not need the ?beta=true the SDK appends", async () => {
      const response = await get("/v1/files");
      expect(response.status).toBe(200);
    });
  });

  // A file source only exists on the beta Messages surface, which is where the
  // SDK's types put it; it posts to /v1/messages?beta=true, the same handler.
  it("echoes the id of a file attached to a message with no prose", async () => {
    const message = await ctx.client.beta.messages.create({
      model: "claude-opus-5",
      max_tokens: 64,
      messages: [
        {
          role: "user",
          content: [{ type: "document", source: { type: "file", file_id: "file_mock_report_pdf" } }],
        },
      ],
    });

    expect((message.content[0] as { text: string }).text).toBe("Echo: [file_mock_report_pdf]");
  });

  it("prefers the prose when a message carries both", async () => {
    const message = await ctx.client.beta.messages.create({
      model: "claude-opus-5",
      max_tokens: 64,
      messages: [
        {
          role: "user",
          content: [
            { type: "document", source: { type: "file", file_id: "file_mock_report_pdf" } },
            { type: "text", text: "Summarise this." },
          ],
        },
      ],
    });

    expect((message.content[0] as { text: string }).text).toBe("Echo: Summarise this.");
  });
});
