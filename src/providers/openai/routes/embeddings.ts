import { Router } from "express";
import { ApiError } from "../../../core/errors";
import { createEmbeddings } from "../services/embeddings";
import type { EmbeddingRequest } from "../types";

export const embeddingsRouter = Router();

embeddingsRouter.post("/", (req, res) => {
  const body = req.body as EmbeddingRequest;
  if (typeof body.model !== "string" || !body.model) {
    throw new ApiError(400, "you must provide a model parameter", null, "model");
  }
  if (body.input === undefined) {
    throw new ApiError(400, "Missing required parameter: 'input'.", "missing_required_parameter", "input");
  }
  res.json(createEmbeddings(body));
});
