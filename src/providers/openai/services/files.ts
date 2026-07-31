import { createHash } from "node:crypto";
import { ApiError } from "../../../core/errors";
import { decodeMetaId, deterministicCreated, encodeMetaId } from "../../../core/ids";
import type { FileDeleted, FileList, FileListQuery, FileObject, FilePurpose } from "../types";

export const FILE_ID_PREFIX = "file-";

// A mock that stores nothing cannot answer "does this file exist?", so the
// 404 flow is driven by the id itself: anything starting with this prefix is
// always reported as missing. Same idea as the documented known-invalid api
// key (sk-mock-invalid) the auth tests rely on.
export const MISSING_FILE_PREFIX = "file-missing";

const UPLOAD_PURPOSES: FilePurpose[] = ["assistants", "batch", "fine-tune", "vision", "user_data", "evals"];

// expires_after bounds enforced by the real API.
const MIN_EXPIRES_SECONDS = 3600;
const MAX_EXPIRES_SECONDS = 2592000;

const MAX_LIST_LIMIT = 10000;

// Metadata carried inside a minted id, kept to single-letter keys so ids stay
// reasonably short: (n)ame, (b)ytes, (p)urpose, (e)xpiry, content (h)ash.
interface FileMeta {
  n: string;
  b: number;
  p: string;
  e?: number;
  h: string;
}

// Simulated catalog behind GET /files, mirroring the fixed model catalog in
// services/models.ts. Uploads never join it — nothing is stored — so it exists
// to make listing, filtering and pagination exercisable at all.
const CATALOG: FileObject[] = [
  {
    id: "file-mock-training-jsonl",
    object: "file",
    bytes: 4096,
    created_at: 1730000000,
    filename: "training-data.jsonl",
    purpose: "fine-tune",
    status: "processed",
  },
  {
    id: "file-mock-validation-jsonl",
    object: "file",
    bytes: 1024,
    created_at: 1730000100,
    filename: "validation-data.jsonl",
    purpose: "fine-tune",
    status: "processed",
  },
  {
    id: "file-mock-manual-pdf",
    object: "file",
    bytes: 20480,
    created_at: 1730000200,
    filename: "manual.pdf",
    purpose: "assistants",
    status: "processed",
  },
  {
    id: "file-mock-batch-input",
    object: "file",
    bytes: 8192,
    created_at: 1730000300,
    filename: "batch-input.jsonl",
    purpose: "batch",
    status: "processed",
  },
  {
    id: "file-mock-diagram-png",
    object: "file",
    bytes: 51200,
    created_at: 1730000400,
    filename: "diagram.png",
    purpose: "vision",
    status: "processed",
  },
];

const TEXT_EXTENSIONS = new Set(["jsonl", "json", "txt", "md", "csv", "c", "cpp", "py", "ts", "js", "html", "css"]);

function contentTypeFor(filename: string): string {
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  return TEXT_EXTENSIONS.has(extension) ? "text/plain" : "application/octet-stream";
}

export function assertUploadPurpose(purpose: unknown): FilePurpose {
  if (typeof purpose !== "string" || !purpose) {
    throw new ApiError(400, "Missing required parameter: 'purpose'.", "missing_required_parameter", "purpose");
  }
  if (!UPLOAD_PURPOSES.includes(purpose as FilePurpose)) {
    const supported = UPLOAD_PURPOSES.map((value) => `'${value}'`).join(", ");
    throw new ApiError(
      400,
      `Invalid value: '${purpose}'. Supported values are: ${supported}.`,
      "invalid_value",
      "purpose",
    );
  }
  return purpose as FilePurpose;
}

// { anchor: "created_at", seconds: N } — the only anchor the API accepts.
export function parseExpiresAfter(raw: unknown): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  const value = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
  if (!value || typeof value !== "object") {
    throw new ApiError(400, "'expires_after' must be an object.", "invalid_value", "expires_after");
  }
  const { anchor, seconds } = value as { anchor?: unknown; seconds?: unknown };
  if (anchor !== "created_at") {
    throw new ApiError(
      400,
      "Invalid value for 'expires_after.anchor'. Supported values are: 'created_at'.",
      "invalid_value",
      "expires_after.anchor",
    );
  }
  const numeric = typeof seconds === "string" ? Number(seconds) : seconds;
  if (typeof numeric !== "number" || !Number.isInteger(numeric)) {
    throw new ApiError(400, "'expires_after.seconds' must be an integer.", "invalid_value", "expires_after.seconds");
  }
  if (numeric < MIN_EXPIRES_SECONDS || numeric > MAX_EXPIRES_SECONDS) {
    throw new ApiError(
      400,
      `'expires_after.seconds' must be between ${MIN_EXPIRES_SECONDS} and ${MAX_EXPIRES_SECONDS}.`,
      "invalid_value",
      "expires_after.seconds",
    );
  }
  return numeric;
}

export interface FileUpload {
  filename: string;
  content: Buffer;
  purpose: FilePurpose;
  expiresAfterSeconds?: number;
}

function toFileObject(id: string, meta: FileMeta): FileObject {
  const created_at = deterministicCreated(id);
  return {
    id,
    object: "file",
    bytes: meta.b,
    created_at,
    ...(meta.e === undefined ? {} : { expires_at: created_at + meta.e }),
    filename: meta.n,
    purpose: meta.p,
    status: "processed",
  };
}

// The returned id encodes the file's metadata, so a later retrieve/content
// call can answer accurately without the mock having stored anything. The
// content hash makes it deterministic: same bytes and name, same id.
export function createFile({ filename, content, purpose, expiresAfterSeconds }: FileUpload): FileObject {
  const meta: FileMeta = {
    n: filename,
    b: content.byteLength,
    p: purpose,
    ...(expiresAfterSeconds === undefined ? {} : { e: expiresAfterSeconds }),
    h: createHash("sha256").update(content).digest("hex").slice(0, 12),
  };
  return toFileObject(encodeMetaId(FILE_ID_PREFIX, meta), meta);
}

// Completing an upload materializes a file object. The parts were streamed and
// dropped, so there are no bytes to hash: the upload id seeds it instead, which
// keeps the resulting file id deterministic per upload.
export function createFileFromUpload(filename: string, bytes: number, purpose: string, seed: string): FileObject {
  const meta: FileMeta = {
    n: filename,
    b: bytes,
    p: purpose,
    h: createHash("sha256").update(seed).digest("hex").slice(0, 12),
  };
  return toFileObject(encodeMetaId(FILE_ID_PREFIX, meta), meta);
}

// Resolution order: the reserved missing prefix, the fixed catalog, then a
// metadata-carrying id minted by an earlier upload, and finally a synthetic
// object derived from the id itself so foreign ids still behave plausibly.
export function retrieveFile(id: string): FileObject {
  if (!id.startsWith(FILE_ID_PREFIX) || id.startsWith(MISSING_FILE_PREFIX)) {
    throw new ApiError(404, `No such File object: ${id}`, null, "id");
  }

  const known = CATALOG.find((file) => file.id === id);
  if (known) return known;

  const decoded = decodeMetaId<FileMeta>(FILE_ID_PREFIX, id);
  if (decoded && typeof decoded.n === "string" && typeof decoded.b === "number" && typeof decoded.p === "string") {
    return toFileObject(id, decoded);
  }

  const hash = createHash("sha256").update(id).digest();
  return toFileObject(id, {
    n: `${id.slice(FILE_ID_PREFIX.length, FILE_ID_PREFIX.length + 8) || "mock"}.dat`,
    b: 1 + (hash.readUInt32BE(0) % 65536),
    p: "assistants",
    h: hash.toString("hex").slice(0, 12),
  });
}

export function deleteFile(id: string): FileDeleted {
  // Same 404 rules as a retrieve, so error handling can be tested either way.
  retrieveFile(id);
  return { id, object: "file", deleted: true };
}

export function listFiles(query: FileListQuery): FileList {
  const limit = query.limit === undefined ? MAX_LIST_LIMIT : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
    throw new ApiError(
      400,
      `'limit' must be an integer between 1 and ${MAX_LIST_LIMIT}.`,
      "invalid_value",
      "limit",
    );
  }
  const order = query.order ?? "desc";
  if (order !== "asc" && order !== "desc") {
    throw new ApiError(400, "Invalid value: 'order'. Supported values are: 'asc', 'desc'.", "invalid_value", "order");
  }
  if (query.purpose !== undefined) assertPurposeFilter(query.purpose);

  let files = query.purpose === undefined ? CATALOG : CATALOG.filter((file) => file.purpose === query.purpose);
  files = [...files].sort((a, b) => (order === "asc" ? a.created_at - b.created_at : b.created_at - a.created_at));

  if (query.after !== undefined) {
    const cursor = files.findIndex((file) => file.id === query.after);
    files = cursor === -1 ? [] : files.slice(cursor + 1);
  }

  const page = files.slice(0, limit);
  return {
    object: "list",
    data: page,
    has_more: files.length > page.length,
    first_id: page[0]?.id ?? null,
    last_id: page[page.length - 1]?.id ?? null,
  };
}

// Listing accepts the read-only purposes too, since the real API can return
// files it generated itself.
function assertPurposeFilter(purpose: string): void {
  const readable = [...UPLOAD_PURPOSES, "assistants_output", "batch_output", "fine-tune-results"];
  if (!readable.includes(purpose)) {
    const supported = readable.map((value) => `'${value}'`).join(", ");
    throw new ApiError(
      400,
      `Invalid value: '${purpose}'. Supported values are: ${supported}.`,
      "invalid_value",
      "purpose",
    );
  }
}

// Deterministic stand-in for the bytes that were uploaded. The mock never
// stored them, so shape the placeholder after the file's purpose and name:
// fine-tune/batch files get valid JSONL, everything else a text marker.
function placeholderContent(file: FileObject): string {
  const isJsonl = file.filename.toLowerCase().endsWith(".jsonl");
  if (isJsonl || file.purpose === "fine-tune" || file.purpose === "batch") {
    const seed = createHash("sha256").update(file.id).digest("hex").slice(0, 8);
    const line = (index: number) => {
      const prompt = `llm-mock sample ${seed} ${index}`;
      return JSON.stringify({
        messages: [
          { role: "user", content: prompt },
          { role: "assistant", content: `Echo: ${prompt}` },
        ],
      });
    };
    return `${line(1)}\n${line(2)}\n`;
  }
  return `llm-mock placeholder content for ${file.filename} (${file.bytes} bytes, purpose ${file.purpose})\n`;
}

export interface FileContent {
  contentType: string;
  body: Buffer;
}

// `override` comes from the x-llm-mock-response header, letting a test pin the
// exact bytes it wants back without registering anything server-side.
export function retrieveFileContent(id: string, override?: string): FileContent {
  const file = retrieveFile(id);
  const text = override ?? placeholderContent(file);
  return { contentType: contentTypeFor(file.filename), body: Buffer.from(text, "utf-8") };
}
