import { createHash } from "node:crypto";
import { ApiError } from "../../../core/errors";
import { decodeMetaId, deterministicCreated, deterministicId, encodeMetaId } from "../../../core/ids";
import type { CompleteUploadRequest, CreateUploadRequest, Upload, UploadPart } from "../types";
import { assertUploadPurpose, createFileFromUpload } from "./files";

const UPLOAD_ID_PREFIX = "upload_";
const PART_ID_PREFIX = "part_";

// Reserved prefix for exercising 404s, mirroring MISSING_FILE_PREFIX.
export const MISSING_UPLOAD_PREFIX = "upload_missing";

// The real API expires an in-flight upload one hour after creation.
const UPLOAD_TTL_SECONDS = 3600;

// Largest single part the API accepts (64 MB).
const MAX_PART_BYTES = 64 * 1024 * 1024;

// Metadata carried inside the upload id so complete/cancel can echo back what
// create was told, with no server state: (n)ame, (b)ytes, (m)ime, (p)urpose.
interface UploadMeta {
  n: string;
  b: number;
  m: string;
  p: string;
}

function assertString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value) {
    throw new ApiError(400, `Missing required parameter: '${field}'.`, "missing_required_parameter", field);
  }
  return value;
}

function toUpload(id: string, meta: UploadMeta, status: Upload["status"]): Upload {
  const created_at = deterministicCreated(id);
  return {
    id,
    object: "upload",
    bytes: meta.b,
    created_at,
    expires_at: created_at + UPLOAD_TTL_SECONDS,
    filename: meta.n,
    purpose: meta.p,
    status,
    file: status === "completed" ? createFileFromUpload(meta.n, meta.b, meta.p, id) : null,
  };
}

export function createUpload(body: CreateUploadRequest): Upload {
  const filename = assertString(body.filename, "filename");
  const mimeType = assertString(body.mime_type, "mime_type");
  const purpose = assertUploadPurpose(body.purpose);
  if (typeof body.bytes !== "number" || !Number.isInteger(body.bytes) || body.bytes < 0) {
    throw new ApiError(400, "'bytes' must be a non-negative integer.", "invalid_value", "bytes");
  }
  const meta: UploadMeta = { n: filename, b: body.bytes, m: mimeType, p: purpose };
  return toUpload(encodeMetaId(UPLOAD_ID_PREFIX, meta), meta, "pending");
}

// Resolves an upload id the same way files resolve theirs: reserved prefix
// means missing, a metadata-carrying id round-trips exactly, and any other
// well-prefixed id gets plausible synthetic metadata.
function resolveUpload(id: string): UploadMeta {
  if (!id.startsWith(UPLOAD_ID_PREFIX) || id.startsWith(MISSING_UPLOAD_PREFIX)) {
    throw new ApiError(404, `No such Upload object: ${id}`, null, "upload_id");
  }
  const decoded = decodeMetaId<UploadMeta>(UPLOAD_ID_PREFIX, id);
  if (
    decoded &&
    typeof decoded.n === "string" &&
    typeof decoded.b === "number" &&
    typeof decoded.p === "string" &&
    typeof decoded.m === "string"
  ) {
    return decoded;
  }
  const hash = createHash("sha256").update(id).digest();
  return {
    n: `${id.slice(UPLOAD_ID_PREFIX.length, UPLOAD_ID_PREFIX.length + 8) || "mock"}.dat`,
    b: 1 + (hash.readUInt32BE(0) % 65536),
    m: "application/octet-stream",
    p: "assistants",
  };
}

// Part bytes are discarded, so the part id is a hash of the upload id and the
// data itself. Uploading byte-identical data twice to the same upload therefore
// yields the same part id — the price of keeping this deterministic.
export function addUploadPart(uploadId: string, content: Buffer): UploadPart {
  resolveUpload(uploadId);
  if (content.byteLength > MAX_PART_BYTES) {
    throw new ApiError(400, `Part exceeds the maximum size of ${MAX_PART_BYTES} bytes.`, "invalid_value", "data");
  }
  const id = deterministicId(PART_ID_PREFIX, {
    upload: uploadId,
    bytes: content.byteLength,
    hash: createHash("sha256").update(content).digest("hex"),
  });
  return { id, object: "upload.part", created_at: deterministicCreated(id), upload_id: uploadId };
}

export function completeUpload(uploadId: string, body: CompleteUploadRequest): Upload {
  const meta = resolveUpload(uploadId);
  if (!Array.isArray(body.part_ids) || body.part_ids.length === 0) {
    throw new ApiError(400, "Missing required parameter: 'part_ids'.", "missing_required_parameter", "part_ids");
  }
  if (!body.part_ids.every((part) => typeof part === "string" && part.startsWith(PART_ID_PREFIX))) {
    throw new ApiError(400, "'part_ids' must be an array of upload part ids.", "invalid_value", "part_ids");
  }
  // The md5 checksum is accepted but not verified: the parts were never kept,
  // so there is nothing to compare against.
  if (body.md5 !== undefined && typeof body.md5 !== "string") {
    throw new ApiError(400, "'md5' must be a string.", "invalid_value", "md5");
  }
  return toUpload(uploadId, meta, "completed");
}

export function cancelUpload(uploadId: string): Upload {
  return toUpload(uploadId, resolveUpload(uploadId), "cancelled");
}
