import { Router } from "express";
import { ApiError } from "../../../core/errors";
import { multipartFile } from "../../../core/multipart";
import { addUploadPart, cancelUpload, completeUpload, createUpload } from "../services/uploads";
import type { CompleteUploadRequest, CreateUploadRequest } from "../types";

export const uploadsRouter = Router();

uploadsRouter.post("/", (req, res) => {
  res.json(createUpload((req.body ?? {}) as CreateUploadRequest));
});

uploadsRouter.post("/:id/parts", multipartFile("data"), (req, res) => {
  const part = req.multipart?.file;
  if (!part) {
    throw new ApiError(400, "Missing required parameter: 'data'.", "missing_required_parameter", "data");
  }
  const { id } = req.params as { id: string };
  res.json(addUploadPart(id, part.content));
});

uploadsRouter.post("/:id/complete", (req, res) => {
  res.json(completeUpload(req.params.id, (req.body ?? {}) as CompleteUploadRequest));
});

uploadsRouter.post("/:id/cancel", (req, res) => {
  res.json(cancelUpload(req.params.id));
});
