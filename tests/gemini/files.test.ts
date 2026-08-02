import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { FileState } from "@google/genai";
import { startTestServer, stopTestServer, VALID_API_KEY, type TestContext } from "./setup";

const CONTENT = "hello world, this is llm-mock";

describe("gemini files", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestServer();
  });
  afterAll(() => stopTestServer(ctx));

  const upload = (content = CONTENT, displayName = "notes.txt") =>
    ctx.client.files.upload({
      file: new Blob([content], { type: "text/plain" }),
      config: { mimeType: "text/plain", displayName },
    });

  const raw = (path: string, init?: RequestInit) =>
    fetch(`${ctx.baseUrl}${path}`, {
      ...init,
      headers: { "x-goog-api-key": VALID_API_KEY, ...init?.headers },
    });

  it("completes the two-step resumable upload through the SDK", async () => {
    const file = await upload();

    expect(file.name).toStartWith("files/");
    expect(file.displayName).toBe("notes.txt");
    expect(file.mimeType).toBe("text/plain");
    expect(file.state).toBe(FileState.ACTIVE);
  });

  it("reports sizeBytes as a string, as every int64 on this API is", async () => {
    const res = await raw("/v1beta/files/mock-catalog-notes");
    const body = (await res.json()) as { sizeBytes: unknown };

    expect(typeof body.sizeBytes).toBe("string");
  });

  it("reports the real sha256 of the bytes it received", async () => {
    const file = await upload();
    const expected = createHash("sha256").update(CONTENT).digest("base64");

    expect(file.sha256Hash).toBe(expected);
  });

  it("round-trips an upload through a later get, holding no store", async () => {
    const uploaded = await upload(CONTENT, "round-trip.txt");
    const fetched = await ctx.client.files.get({ name: uploaded.name ?? "" });

    expect(fetched.name).toBe(uploaded.name);
    expect(fetched.displayName).toBe("round-trip.txt");
    expect(fetched.mimeType).toBe("text/plain");
    expect(fetched.sizeBytes).toBe(String(CONTENT.length));
    expect(fetched.sha256Hash).toBe(uploaded.sha256Hash);
  });

  it("mints names past Google's 40-character input cap, which clients do not enforce", async () => {
    const file = await upload();
    const id = (file.name ?? "").replace("files/", "");

    // The cap applies to names a client supplies, not to ones the server hands
    // back, which is what lets the id carry the metadata for the round-trip.
    expect(id.length).toBeGreaterThan(40);
    await expect(ctx.client.files.get({ name: file.name ?? "" })).resolves.toBeDefined();
  });

  it("sets an expiration 48 hours after creation", async () => {
    const file = await upload();
    const created = Date.parse(file.createTime ?? "");
    const expires = Date.parse(file.expirationTime ?? "");

    expect(expires - created).toBe(48 * 60 * 60 * 1000);
  });

  it("is deterministic: same bytes and name, same resource", async () => {
    const [first, second] = [await upload(), await upload()];
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("gives different names to different content", async () => {
    const [a, b] = [await upload("one"), await upload("two")];
    expect(a.name).not.toBe(b.name);
  });

  it("lists the simulated catalog", async () => {
    const pager = await ctx.client.files.list();
    const names: (string | undefined)[] = [];
    for await (const file of pager) names.push(file.displayName);

    expect(names).toContain("quarterly-report.pdf");
    expect(names).toContain("demo-clip.mp4");
  });

  it("paginates the catalog with pageSize and pageToken", async () => {
    const first = (await raw("/v1beta/files?pageSize=2").then((r) => r.json())) as {
      files: { name: string }[];
      nextPageToken?: string;
    };
    expect(first.files).toHaveLength(2);
    expect(first.nextPageToken).toBeTruthy();

    const second = (await raw(`/v1beta/files?pageSize=2&pageToken=${first.nextPageToken}`).then((r) =>
      r.json(),
    )) as { files: { name: string }[]; nextPageToken?: string };
    expect(second.files.map((file) => file.name)).not.toEqual(first.files.map((file) => file.name));
    expect(second.nextPageToken).toBeUndefined();
  });

  it("rejects an out-of-range pageSize", async () => {
    const res = await raw("/v1beta/files?pageSize=0");
    expect(res.status).toBe(400);

    const body = (await res.json()) as { error: { status: string } };
    expect(body.error.status).toBe("INVALID_ARGUMENT");
  });

  it("deletes with google.protobuf.Empty", async () => {
    const file = await upload();
    const res = await raw(`/v1beta/${file.name}`, { method: "DELETE" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
  });

  it("reports a reserved missing name the way the real API does", async () => {
    const res = await raw("/v1beta/files/missing-one");
    expect(res.status).toBe(403);

    const body = (await res.json()) as { error: { message: string; status: string } };
    expect(body.error.status).toBe("PERMISSION_DENIED");
    expect(body.error.message).toContain("or it may not exist");
  });

  it("synthesizes a plausible file for a name it never minted", async () => {
    const file = await ctx.client.files.get({ name: "files/abc123xyz" });

    expect(file.name).toBe("files/abc123xyz");
    expect(file.displayName).toBeTruthy();
    expect(Number(file.sizeBytes)).toBeGreaterThan(0);
  });

  describe("the resumable protocol itself", () => {
    it("hands back an upload URL pointing at this mock", async () => {
      const res = await raw("/upload/v1beta/files", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-upload-protocol": "resumable",
          "x-goog-upload-command": "start",
        },
        body: JSON.stringify({ file: { displayName: "a.txt", mimeType: "text/plain", sizeBytes: "5" } }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("x-goog-upload-status")).toBe("active");
      expect(res.headers.get("x-goog-upload-url")).toContain("/gemini/upload/v1beta/files?upload_id=");
    });

    it("returns the finalized file nested under `file`", async () => {
      const start = await raw("/upload/v1beta/files", {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-upload-command": "start" },
        body: JSON.stringify({ file: { displayName: "b.txt", mimeType: "text/plain" } }),
      });
      const uploadUrl = start.headers.get("x-goog-upload-url") ?? "";

      const finalize = await fetch(uploadUrl, {
        method: "POST",
        headers: { "x-goog-api-key": VALID_API_KEY, "x-goog-upload-command": "upload, finalize" },
        body: "12345",
      });

      expect(finalize.headers.get("x-goog-upload-status")).toBe("final");
      const body = (await finalize.json()) as { file: { displayName: string; sizeBytes: string } };
      expect(body.file.displayName).toBe("b.txt");
      expect(body.file.sizeBytes).toBe("5");
    });

    it("reads the bytes raw, so file content is never parsed as a JSON body", async () => {
      const start = await raw("/upload/v1beta/files", {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-upload-command": "start" },
        body: JSON.stringify({ file: { displayName: "c.txt", mimeType: "text/plain" } }),
      });

      // The SDK sends the bytes under an application/json content type; this is
      // what would break if the JSON parser saw them first.
      const finalize = await fetch(start.headers.get("x-goog-upload-url") ?? "", {
        method: "POST",
        headers: {
          "x-goog-api-key": VALID_API_KEY,
          "content-type": "application/json",
          "x-goog-upload-command": "upload, finalize",
        },
        body: "this is definitely not json {[",
      });

      expect(finalize.status).toBe(200);
      const body = (await finalize.json()) as { file: { sizeBytes: string } };
      expect(body.file.sizeBytes).toBe("30");
    });

    it("falls back to the X-Goog-Upload-File-Name header for the display name", async () => {
      const start = await raw("/upload/v1beta/files", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-upload-command": "start",
          "x-goog-upload-file-name": "from-header.bin",
        },
        body: "",
      });

      const finalize = await fetch(start.headers.get("x-goog-upload-url") ?? "", {
        method: "POST",
        headers: { "x-goog-api-key": VALID_API_KEY, "x-goog-upload-command": "upload, finalize" },
        body: "x",
      });
      const body = (await finalize.json()) as { file: { displayName: string } };

      expect(body.file.displayName).toBe("from-header.bin");
    });

    it("rejects a finalize whose session token it never issued", async () => {
      const res = await raw("/upload/v1beta/files?upload_id=nonsense", {
        method: "POST",
        headers: { "x-goog-upload-command": "upload, finalize" },
        body: "bytes",
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { message: string } };
      expect(body.error.message).toContain("upload session");
    });

    it("rejects a request with no upload command", async () => {
      const res = await raw("/upload/v1beta/files", { method: "POST", body: "bytes" });
      expect(res.status).toBe(400);
    });

    it("requires authentication, being outside the version router", async () => {
      const res = await fetch(`${ctx.baseUrl}/upload/v1beta/files`, {
        method: "POST",
        headers: { "x-goog-upload-command": "start" },
      });

      expect(res.status).toBe(403);
    });
  });
});
