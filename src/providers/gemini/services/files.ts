import { createHash } from "node:crypto";
import { ApiError } from "../../../core/errors";
import { decodeMetaId, deterministicCreated, encodeMetaId } from "../../../core/ids";
import type { GeminiFile, ListFilesResponse } from "../types";

// Ids minted by this mock carry their own metadata, which is what lets an
// upload round-trip through a later GET without anything being stored. Google
// caps a *client-supplied* name at 40 characters, but nothing validates a name
// the server hands back — verified against @google/genai — so the encoding is
// free to be as long as the metadata needs.
export const FILE_ID_PREFIX = "mock-";

// A mock that stores nothing cannot answer "does this file exist?", so the
// error flow is driven by the id itself: anything starting with this prefix is
// always reported as missing.
export const MISSING_FILE_PREFIX = "missing";

// Files expire 48 hours after upload in the real API.
const LIFETIME_SECONDS = 48 * 60 * 60;

const DEFAULT_MIME_TYPE = "application/octet-stream";

const MAX_PAGE_SIZE = 100;

// Single-letter keys keep the encoded id from growing without reason:
// display (n)ame, (m)ime type, (b)ytes, content (h)ash. The hash is the full
// base64 digest rather than a truncation, so the sha256Hash reported back is
// the real one for the bytes received and a client that verifies it succeeds.
interface FileMeta {
  n: string;
  m: string;
  b: number;
  h: string;
}

function digestOf(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("base64");
}

// Simulated catalog behind GET /files. Uploads never join it — nothing is
// stored — so it exists to make listing and pagination exercisable at all.
const CATALOG: GeminiFile[] = [
  buildCatalogEntry("files/mock-catalog-report", "quarterly-report.pdf", "application/pdf", 20480),
  buildCatalogEntry("files/mock-catalog-notes", "meeting-notes.txt", "text/plain", 4096),
  buildCatalogEntry("files/mock-catalog-diagram", "architecture.png", "image/png", 51200),
  buildCatalogEntry("files/mock-catalog-clip", "demo-clip.mp4", "video/mp4", 1048576),
];

function buildCatalogEntry(name: string, displayName: string, mimeType: string, bytes: number): GeminiFile {
  // No bytes exist behind a catalog entry, so its hash is seeded by the name.
  return toFile(name, { n: displayName, m: mimeType, b: bytes, h: digestOf(name) });
}

function isoFrom(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

function toFile(name: string, meta: FileMeta): GeminiFile {
  const created = deterministicCreated(name);
  const stamp = isoFrom(created);
  return {
    name,
    displayName: meta.n,
    mimeType: meta.m,
    sizeBytes: String(meta.b),
    createTime: stamp,
    updateTime: stamp,
    expirationTime: isoFrom(created + LIFETIME_SECONDS),
    sha256Hash: meta.h,
    // Points at Google rather than at this mock on purpose: the value is opaque
    // to clients, which only ever hand it back in a fileData part, and keeping
    // it host-independent is what keeps responses byte-identical everywhere.
    uri: `https://generativelanguage.googleapis.com/v1beta/${name}`,
    state: "ACTIVE",
  };
}

// A resumable upload spans two requests, and the mock keeps no session table
// between them: the metadata declared at `start` travels back to the client
// inside the upload URL and returns with the bytes.
interface SessionMeta {
  n: string;
  m: string;
}

export function encodeUploadSession(displayName: string, mimeType: string): string {
  return encodeMetaId("", { n: displayName, m: mimeType } satisfies SessionMeta);
}

export function decodeUploadSession(token: unknown): { displayName: string; mimeType: string } {
  const decoded = typeof token === "string" ? decodeMetaId<SessionMeta>("", token) : undefined;
  if (!decoded || typeof decoded.n !== "string" || typeof decoded.m !== "string") {
    throw new ApiError(400, "Invalid or expired upload session.", "INVALID_ARGUMENT");
  }
  return { displayName: decoded.n, mimeType: decoded.m };
}

export interface FileUpload {
  displayName: string;
  mimeType: string;
  content: Buffer;
}

// The minted name encodes the file's metadata, so a later GET can answer
// accurately without the mock having stored anything. The content hash makes it
// deterministic: same bytes, same name, same id.
export function createFile({ displayName, mimeType, content }: FileUpload): GeminiFile {
  const meta: FileMeta = {
    n: displayName,
    m: mimeType || DEFAULT_MIME_TYPE,
    b: content.byteLength,
    h: digestOf(content),
  };
  return toFile(`files/${encodeMetaId(FILE_ID_PREFIX, meta)}`, meta);
}

// Callers address a file either bare ("abc123") or by resource name
// ("files/abc123"); both reach the same entry.
function resourceName(id: string): string {
  return id.startsWith("files/") ? id : `files/${id}`;
}

// This is the error the real API answers for a file that is missing or owned by
// someone else — it does not distinguish the two cases. It echoes the id as the
// caller wrote it, without the resource prefix.
function notFound(id: string): ApiError {
  return new ApiError(
    403,
    `You do not have permission to access the File ${id} or it may not exist.`,
    "PERMISSION_DENIED",
  );
}

// Resolution order: the reserved missing prefix, the fixed catalog, then a
// metadata-carrying name minted by an earlier upload, and finally a synthetic
// file derived from the name itself so foreign ids still behave plausibly.
export function retrieveFile(id: string): GeminiFile {
  const name = resourceName(id);
  const bare = name.slice("files/".length);
  if (bare.startsWith(MISSING_FILE_PREFIX)) throw notFound(bare);

  const known = CATALOG.find((file) => file.name === name);
  if (known) return known;

  const decoded = decodeMetaId<FileMeta>(FILE_ID_PREFIX, bare);
  if (decoded && typeof decoded.n === "string" && typeof decoded.m === "string" && typeof decoded.b === "number") {
    return toFile(name, decoded);
  }

  const hash = createHash("sha256").update(name).digest();
  return toFile(name, {
    n: `${bare.slice(0, 8) || "mock"}.dat`,
    m: DEFAULT_MIME_TYPE,
    b: 1 + (hash.readUInt32BE(0) % 65536),
    h: hash.toString("base64"),
  });
}

export function deleteFile(id: string): void {
  // Same rules as a retrieve, so the error path can be tested either way.
  retrieveFile(id);
}

export interface FileListQuery {
  pageSize?: string;
  pageToken?: string;
}

export function listFiles(query: FileListQuery): ListFilesResponse {
  const pageSize = query.pageSize === undefined ? MAX_PAGE_SIZE : Number(query.pageSize);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw new ApiError(
      400,
      `pageSize must be an integer between 1 and ${MAX_PAGE_SIZE}.`,
      "INVALID_ARGUMENT",
    );
  }

  // The token is the name of the last file already seen, which needs no state.
  let files = CATALOG;
  if (query.pageToken !== undefined) {
    const cursor = files.findIndex((file) => file.name === query.pageToken);
    files = cursor === -1 ? [] : files.slice(cursor + 1);
  }

  const page = files.slice(0, pageSize);
  const hasMore = files.length > page.length;
  return {
    files: page,
    ...(hasMore ? { nextPageToken: page[page.length - 1]!.name } : {}),
  };
}
