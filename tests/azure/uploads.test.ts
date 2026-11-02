import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { startTestServer, stopTestServer, type TestContext } from "./setup";

const CREATE_PARAMS = {
  filename: "training-examples.jsonl",
  bytes: 2048,
  mime_type: "text/jsonl",
  purpose: "fine-tune",
} as const;

// Uploads are not deployment-scoped: the SDK sends them to /openai/uploads
// with its api-version on the classic surface and to /openai/v1/uploads on
// the other, and OpenAI's router answers both.
describe("azure uploads", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestServer();
  });
  afterAll(() => stopTestServer(ctx));

  for (const [surface, client] of [
    ["classic", () => ctx.classic],
    ["v1", () => ctx.v1],
  ] as const) {
    it(`runs the chunked flow through to a file on the ${surface} surface`, async () => {
      const upload = await client().uploads.create(CREATE_PARAMS);
      expect(upload.object).toBe("upload");
      expect(upload.status).toBe("pending");

      const part = await client().uploads.parts.create(upload.id, { data: new Blob(["part one"]) });
      expect(part.upload_id).toBe(upload.id);

      const completed = await client().uploads.complete(upload.id, { part_ids: [part.id] });
      expect(completed.status).toBe("completed");
      expect(completed.file?.filename).toBe(CREATE_PARAMS.filename);

      const file = await client().files.retrieve(completed.file?.id ?? "");
      expect(file).toEqual(completed.file!);
    });
  }

  it("cancels", async () => {
    const upload = await ctx.classic.uploads.create(CREATE_PARAMS);
    const cancelled = await ctx.classic.uploads.cancel(upload.id);
    expect(cancelled.status).toBe("cancelled");
  });
});
