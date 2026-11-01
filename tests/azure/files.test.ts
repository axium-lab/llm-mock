import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { NotFoundError, toFile } from "openai";
import { API_VERSION, startTestServer, stopTestServer, VALID_API_KEY, type TestContext } from "./setup";

interface ErrorBody {
  error: { code: string; message: string };
}

const sample = (text = '{"prompt":"hi"}\n', name = "training.jsonl") => toFile(Buffer.from(text), name);

// Files are not deployment-scoped on Azure: the SDK sends them to
// /openai/files?api-version= on the classic surface and to /openai/v1/files on
// the other. The payloads are OpenAI's, and so is the stateless round-trip.
describe("azure files", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestServer();
  });
  afterAll(() => stopTestServer(ctx));

  const raw = (path: string, init?: RequestInit) =>
    fetch(`${ctx.baseUrl}${path}`, { ...init, headers: { "api-key": VALID_API_KEY, ...init?.headers } });

  for (const [surface, client] of [
    ["classic", () => ctx.classic],
    ["v1", () => ctx.v1],
  ] as const) {
    describe(`${surface} surface`, () => {
      it("uploads a file and round-trips it through retrieve", async () => {
        const created = await client().files.create({ file: await sample(), purpose: "fine-tune" });
        expect(created.object).toBe("file");
        expect(created.id).toStartWith("file-");
        expect(created.filename).toBe("training.jsonl");
        expect(created.bytes).toBe(16);

        const retrieved = await client().files.retrieve(created.id);
        expect(retrieved).toEqual(created);
      });

      it("serves content for an uploaded id", async () => {
        // The bytes are never stored, so what comes back is the placeholder
        // the OpenAI provider builds from the metadata carried in the id.
        const created = await client().files.create({ file: await sample("hello there\n", "notes.txt"), purpose: "assistants" });
        const content = await client().files.content(created.id);
        expect(await content.text()).toContain("notes.txt");
      });

      it("lists the simulated catalog and deletes any id", async () => {
        const listed = await client().files.list();
        expect(Array.isArray(listed.data)).toBe(true);

        const deleted = await client().files.delete("file-anything");
        expect(deleted).toMatchObject({ id: "file-anything", object: "file", deleted: true });
      });

      it("404s the reserved missing id", async () => {
        try {
          await client().files.retrieve("file-missing-123");
          throw new Error("expected the request to fail");
        } catch (error) {
          expect(error).toBeInstanceOf(NotFoundError);
        }
      });
    });
  }

  it("requires api-version on the classic surface only", async () => {
    const classic = await raw("/files");
    expect(classic.status).toBe(400);
    expect(((await classic.json()) as ErrorBody).error.code).toBe("MissingApiVersionParameter");

    const v1 = await raw("/v1/files");
    expect(v1.status).toBe(200);
  });

  it("gives both surfaces the same listing", async () => {
    const [v1, classic] = await Promise.all([
      raw("/v1/files").then((r) => r.text()),
      raw(`/files?api-version=${API_VERSION}`).then((r) => r.text()),
    ]);
    expect(v1).toBe(classic);
  });
});
