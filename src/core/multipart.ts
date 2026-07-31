import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ApiError } from "./errors";

export interface MultipartFile {
  filename: string;
  content: Buffer;
}

export interface MultipartBody {
  file?: MultipartFile;
  fields: Record<string, string>;
}

declare global {
  namespace Express {
    interface Request {
      multipart?: MultipartBody;
    }
  }
}

function readRawBody(req: Request): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// Parses multipart/form-data into req.multipart, exposing the named file part
// and every text field.
//
// The runtime's own Web API parser does the work instead of a middleware like
// multer: SDKs send a sliced chunk as a Blob with no name (filename=""), and
// multer drops those parts silently, which would make the mock reject requests
// the real API accepts. Uploaded bytes are held in memory just long enough to
// be hashed — nothing is ever written to disk.
export function multipartFile(field: string): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const contentType = req.headers["content-type"] ?? "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
      next();
      return;
    }

    void (async () => {
      try {
        const raw = await readRawBody(req);
        const form = await new Response(raw, { headers: { "content-type": contentType } }).formData();

        const fields: Record<string, string> = {};
        let file: MultipartFile | undefined;
        for (const [key, value] of form.entries()) {
          if (typeof value === "string") {
            fields[key] = value;
          } else if (key === field && !file) {
            file = { filename: value.name, content: Buffer.from(await value.arrayBuffer()) };
          }
        }

        req.multipart = { file, fields };
        next();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Malformed multipart/form-data request.";
        next(new ApiError(400, message, "invalid_multipart_request", field));
      }
    })();
  };
}

// Rebuilds a nested object from the flattened keys the official SDKs emit for
// multipart requests (expires_after[anchor]=created_at), while still accepting
// a plain JSON string for hand-written curl calls.
export function nestedField(fields: Record<string, string> | undefined, field: string): unknown {
  if (!fields) return undefined;
  if (fields[field] !== undefined) return fields[field];

  const prefix = `${field}[`;
  const nested: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (key.startsWith(prefix) && key.endsWith("]")) {
      nested[key.slice(prefix.length, -1)] = value;
    }
  }
  return Object.keys(nested).length === 0 ? undefined : nested;
}
