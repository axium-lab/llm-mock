import { Router } from "express";
import { ApiError } from "../../../middleware/error-handler";
import { createEmbeddings } from "../services/embeddings";
import type { EmbeddingRequest } from "../types";

export const embeddingsRouter = Router();

embeddingsRouter.post("/", (req, res) => {
  const body = req.body as EmbeddingRequest;
  if (typeof body.model !== "string" || !body.model) {
    throw new ApiError(400, "you must provide a model parameter", "invalid_request_error", null, "model");
  }
  if (body.input === undefined) {
    throw new ApiError(400, "Missing required parameter: 'input'.", "invalid_request_error", "missing_required_parameter", "input");
  }
  res.json(createEmbeddings(body));
});
