import { Router } from "express";
import { ApiError } from "../../../core/errors";
import { multipartFile, nestedField } from "../../../core/multipart";
import { responseOverride } from "../../../core/override";
import {
  assertUploadPurpose,
  createFile,
  deleteFile,
  listFiles,
  parseExpiresAfter,
  retrieveFile,
  retrieveFileContent,
} from "../services/files";
import type { FileListQuery } from "../types";

export const filesRouter = Router();

filesRouter.post("/", multipartFile("file"), (req, res) => {
  const part = req.multipart?.file;
  if (!part) {
    throw new ApiError(400, "Missing required parameter: 'file'.", "missing_required_parameter", "file");
  }
  const fields = req.multipart?.fields;
  const purpose = assertUploadPurpose(fields?.purpose);
  const expiresAfterSeconds = parseExpiresAfter(nestedField(fields, "expires_after"));
  res.json(
    createFile({
      // A Blob carries no name; the real API still needs one, so fall back the
      // way its own clients do.
      filename: part.filename || "upload",
      content: part.content,
      purpose,
      expiresAfterSeconds,
    }),
  );
});

filesRouter.get("/", (req, res) => {
  res.json(listFiles(req.query as FileListQuery));
});

// Registered before /:id so the literal segment wins over the parameter.
filesRouter.get("/:id/content", (req, res) => {
  const { contentType, body } = retrieveFileContent(req.params.id, responseOverride(req));
  res.type(contentType).send(body);
});

filesRouter.get("/:id", (req, res) => {
  res.json(retrieveFile(req.params.id));
});

filesRouter.delete("/:id", (req, res) => {
  res.json(deleteFile(req.params.id));
});
