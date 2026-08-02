import { Router, type Request } from "express";
import { ApiError } from "../../../core/errors";
import {
  createFile,
  decodeUploadSession,
  deleteFile,
  encodeUploadSession,
  listFiles,
  retrieveFile,
  type FileListQuery,
} from "../services/files";
import type { UploadStartMetadata } from "../types";

export const filesRouter = Router();

filesRouter.get("/", (req, res) => {
  res.json(listFiles(req.query as FileListQuery));
});

filesRouter.get("/:id", (req, res) => {
  res.json(retrieveFile(req.params.id));
});

// google.protobuf.Empty on the wire.
filesRouter.delete("/:id", (req, res) => {
  deleteFile(req.params.id);
  res.json({});
});

// The resumable upload endpoint. Google versions it under /upload, before the
// version segment, so it is mounted outside the /v1beta router — and the
// client always addresses it as upload/v1beta/files whatever apiVersion it is
// otherwise configured with.
export const uploadRouter = Router();

const DEFAULT_MIME_TYPE = "application/octet-stream";

function headerValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

uploadRouter.post("/", (req, res) => {
  const command = headerValue(req.headers["x-goog-upload-command"]) ?? "";
  // The body is a Buffer here: upload bytes travel under an application/json
  // content type, so this route reads raw and parses JSON itself.
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

  if (command.includes("start")) {
    res
      .status(200)
      .set({
        "x-goog-upload-url": startSessionUrl(req, raw),
        "x-goog-upload-status": "active",
      })
      .end();
    return;
  }

  if (!command.includes("upload")) {
    throw new ApiError(
      400,
      "Missing or unsupported X-Goog-Upload-Command. Expected 'start' or 'upload, finalize'.",
      "INVALID_ARGUMENT",
    );
  }

  const { displayName, mimeType } = decodeUploadSession(req.query.upload_id);
  const file = createFile({ displayName, mimeType, content: raw });
  // The finalized file comes back nested under `file`, unlike every read on
  // this API, which returns the resource bare.
  res.set("x-goog-upload-status", "final").json({ file });
});

// Hands the client back a URL pointing at this same endpoint, carrying the
// declared metadata so the second request needs no server-side session.
function startSessionUrl(req: Request, raw: Buffer): string {
  let metadata: UploadStartMetadata = {};
  if (raw.length > 0) {
    try {
      metadata = ((JSON.parse(raw.toString("utf-8")) as { file?: UploadStartMetadata }).file ?? {});
    } catch {
      throw new ApiError(400, "Invalid JSON payload received.", "INVALID_ARGUMENT");
    }
  }

  const displayName =
    metadata.displayName ?? headerValue(req.headers["x-goog-upload-file-name"]) ?? "upload";
  const mimeType =
    metadata.mimeType ?? headerValue(req.headers["x-goog-upload-header-content-type"]) ?? DEFAULT_MIME_TYPE;

  const origin = `${req.protocol}://${req.get("host") ?? "localhost"}`;
  const session = encodeUploadSession(displayName, mimeType);
  return `${origin}${req.baseUrl}?upload_id=${session}&upload_protocol=resumable`;
}
