import { Router, type NextFunction, type Request, type Response } from "express";
import { ApiError } from "../../../core/errors";
import { multipartFile } from "../../../core/multipart";
import { responseOverride } from "../../../core/override";
import { createFile, deleteFile, listFiles, retrieveFile, retrieveFileContent } from "../services/files";
import type { FileListQuery } from "../types";

export const filesRouter = Router();

// The Files API is still behind a beta flag, and the flag is part of its
// contract: every call has to opt in by name.
const FILES_BETA = "files-api-2025-04-14";

// `anthropic-beta` can arrive repeated as well as comma-separated — the SDK
// joins its own list with commas, but a hand-written client may send the header
// twice, and Express hands those over as an array.
function requestedBetas(req: Request): string[] {
  const header = req.headers["anthropic-beta"];
  const values = Array.isArray(header) ? header : header === undefined ? [] : [header];
  return values.flatMap((value) => value.split(",").map((beta) => beta.trim())).filter(Boolean);
}

function requireFilesBeta(req: Request, _res: Response, next: NextFunction): void {
  if (requestedBetas(req).includes(FILES_BETA)) {
    next();
    return;
  }
  next(
    new ApiError(
      400,
      `The Files API is in beta. Set the anthropic-beta header to ${FILES_BETA} to use it.`,
      "invalid_request_error",
    ),
  );
}

filesRouter.use(requireFilesBeta);

filesRouter.post("/", multipartFile("file"), (req, res) => {
  const part = req.multipart?.file;
  if (!part) {
    throw new ApiError(400, "file: Field required", "invalid_request_error");
  }
  res.json(
    createFile({
      // A Blob carries no name; the real API still needs one, so fall back the
      // way its own clients do.
      filename: part.filename || "upload",
      content: part.content,
      contentType: part.contentType,
    }),
  );
});

filesRouter.get("/", (req, res) => {
  res.json(listFiles(req.query as FileListQuery));
});

// Registered before /:id so the literal segment wins over the parameter.
filesRouter.get("/:id/content", (req, res) => {
  const { mimeType, body } = retrieveFileContent(req.params.id, responseOverride(req));
  res.type(mimeType).send(body);
});

filesRouter.get("/:id", (req, res) => {
  res.json(retrieveFile(req.params.id));
});

filesRouter.delete("/:id", (req, res) => {
  res.json(deleteFile(req.params.id));
});
