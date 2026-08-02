import { createHash } from "node:crypto";
import { ApiError } from "../../../core/errors";
import { decodeMetaId, deterministicCreated, encodeMetaId } from "../../../core/ids";
import type { FileDeleted, FileList, FileListQuery, FileMetadata } from "../types";

export const FILE_ID_PREFIX = "file_";

// A mock that stores nothing cannot answer "does this file exist?", so the
// 404 flow is driven by the id itself: anything starting with this prefix is
// always reported as missing. Same convention as `file-missing` on OpenAI and
// `files/missing…` on Gemini.
export const MISSING_FILE_PREFIX = "file_missing";

const MAX_LIMIT = 1000;

// 500 MB per file, the documented ceiling.
const MAX_FILE_BYTES = 500 * 1024 * 1024;

// Metadata carried inside a minted id, single-letter keys so ids stay short:
// (n)ame, (b)ytes, (m)ime type, content (h)ash.
interface FileMeta {
  n: string;
  b: number;
  m: string;
  h: string;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  jsonl: "application/x-jsonl",
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

function mimeFor(filename: string, declared: string): string {
  // The declared type carries parameters — the SDK's own `toFile` helper sends
  // `text/plain;charset=utf-8` — and the API reports the bare type.
  const bare = declared.split(";")[0]?.trim().toLowerCase() ?? "";
  if (bare) return bare;

  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXTENSION[extension] ?? "application/octet-stream";
}

function isoFrom(seconds: number): string {
  return `${new Date(seconds * 1000).toISOString().slice(0, 19)}Z`;
}

// Simulated catalog behind GET /files. Uploads never join it — nothing is
// stored — so it exists to make listing and pagination exercisable at all.
//
// The two `container_` entries stand in for files the code execution tool
// produced. They are the only downloadable ones, which is the real API's rule
// and the only way to exercise the download path at all.
const CATALOG: FileMetadata[] = [
  {
    id: "file_mock_report_pdf",
    type: "file",
    filename: "quarterly-report.pdf",
    mime_type: "application/pdf",
    size_bytes: 248_192,
    created_at: "2026-01-05T09:00:00Z",
    downloadable: false,
  },
  {
    id: "file_mock_dataset_csv",
    type: "file",
    filename: "dataset.csv",
    mime_type: "text/csv",
    size_bytes: 12_048,
    created_at: "2026-01-06T09:00:00Z",
    downloadable: false,
  },
  {
    id: "file_mock_diagram_png",
    type: "file",
    filename: "diagram.png",
    mime_type: "image/png",
    size_bytes: 88_301,
    created_at: "2026-01-07T09:00:00Z",
    downloadable: false,
  },
  {
    id: "file_mock_container_output_txt",
    type: "file",
    filename: "output.txt",
    mime_type: "text/plain",
    size_bytes: 512,
    created_at: "2026-01-08T09:00:00Z",
    downloadable: true,
  },
  {
    id: "file_mock_container_plot_png",
    type: "file",
    filename: "plot.png",
    mime_type: "image/png",
    size_bytes: 34_770,
    created_at: "2026-01-09T09:00:00Z",
    downloadable: true,
    scope: { id: "session_mock_01", type: "session" },
  },
];

export function fileNotFound(id: string): ApiError {
  return new ApiError(404, `file: ${id}`, "not_found_error");
}

function toFileMetadata(id: string, meta: FileMeta): FileMetadata {
  return {
    id,
    type: "file",
    filename: meta.n,
    mime_type: meta.m,
    size_bytes: meta.b,
    created_at: isoFrom(deterministicCreated(id)),
    // An uploaded file is never downloadable on the real API.
    downloadable: false,
  };
}

export interface FileUpload {
  filename: string;
  content: Buffer;
  contentType: string;
}

// The returned id encodes the file's metadata, so a later retrieve call can
// answer accurately without the mock having stored anything. The content hash
// makes it deterministic: same bytes and name, same id.
export function createFile({ filename, content, contentType }: FileUpload): FileMetadata {
  if (!filename) {
    throw new ApiError(400, "file: Field required", "invalid_request_error");
  }
  if (content.byteLength > MAX_FILE_BYTES) {
    throw new ApiError(413, `file: exceeds the maximum size of ${MAX_FILE_BYTES} bytes`, "request_too_large");
  }

  const meta: FileMeta = {
    n: filename,
    b: content.byteLength,
    m: mimeFor(filename, contentType),
    h: createHash("sha256").update(content).digest("hex").slice(0, 12),
  };
  return toFileMetadata(encodeMetaId(FILE_ID_PREFIX, meta), meta);
}

// Resolution order: the reserved missing prefix, the fixed catalog, then a
// metadata-carrying id minted by an earlier upload, and finally a synthetic
// file derived from the id itself so a foreign id still behaves plausibly.
export function retrieveFile(id: string): FileMetadata {
  if (!id.startsWith(FILE_ID_PREFIX) || id.startsWith(MISSING_FILE_PREFIX)) {
    throw fileNotFound(id);
  }

  const known = CATALOG.find((file) => file.id === id);
  if (known) return known;

  const decoded = decodeMetaId<FileMeta>(FILE_ID_PREFIX, id);
  if (decoded && typeof decoded.n === "string" && typeof decoded.b === "number" && typeof decoded.m === "string") {
    return toFileMetadata(id, decoded);
  }

  const hash = createHash("sha256").update(id).digest();
  const filename = `${id.slice(FILE_ID_PREFIX.length, FILE_ID_PREFIX.length + 8) || "mock"}.dat`;
  return toFileMetadata(id, {
    n: filename,
    b: 1 + (hash.readUInt32BE(0) % 65536),
    m: mimeFor(filename, ""),
    h: hash.toString("hex").slice(0, 12),
  });
}

export function deleteFile(id: string): FileDeleted {
  // Same 404 rules as a retrieve, so error handling can be tested either way.
  retrieveFile(id);
  return { id, type: "file_deleted" };
}

// Cursor pagination by id, the same scheme the model catalog uses.
export function listFiles(query: FileListQuery): FileList {
  const limit = query.limit === undefined ? 20 : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new ApiError(400, `limit: must be a positive integer no greater than ${MAX_LIMIT}`, "invalid_request_error");
  }

  let files = CATALOG;
  if (query.scope_id !== undefined) {
    files = files.filter((file) => file.scope?.id === query.scope_id);
  }
  if (query.after_id !== undefined) {
    const cursor = files.findIndex((file) => file.id === query.after_id);
    files = cursor === -1 ? [] : files.slice(cursor + 1);
  }
  if (query.before_id !== undefined) {
    const cursor = files.findIndex((file) => file.id === query.before_id);
    files = cursor === -1 ? [] : files.slice(0, cursor);
  }

  const page = files.slice(0, limit);
  return {
    data: page,
    has_more: files.length > page.length,
    first_id: page[0]?.id ?? null,
    last_id: page[page.length - 1]?.id ?? null,
  };
}

export interface FileContent {
  mimeType: string;
  body: Buffer;
}

// Deterministic stand-in for bytes the mock never kept. `override` comes from
// the x-llm-mock-response header, so a test can pin exactly what it gets back.
export function retrieveFileContent(id: string, override?: string): FileContent {
  const file = retrieveFile(id);
  if (!file.downloadable) {
    // The real API only lets you read back what it created itself; what you
    // uploaded, you already have.
    throw new ApiError(
      403,
      `file: ${id} is not downloadable. Only files created by the API, such as code execution output, can be downloaded.`,
      "permission_error",
    );
  }

  const text = override ?? `llm-mock placeholder content for ${file.filename} (${file.size_bytes} bytes)\n`;
  return { mimeType: file.mime_type, body: Buffer.from(text, "utf-8") };
}
