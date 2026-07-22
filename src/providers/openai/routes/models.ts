import { Router } from "express";
import { ApiError } from "../../../middleware/error-handler";
import { getModel, listModels } from "../services/models";

export const modelsRouter = Router();

modelsRouter.get("/", (_req, res) => {
  res.json(listModels());
});

modelsRouter.get("/:id", (req, res) => {
  const model = getModel(req.params.id);
  if (!model) {
    throw new ApiError(
      404,
      `The model '${req.params.id}' does not exist`,
      "invalid_request_error",
      "model_not_found",
      "model",
    );
  }
  res.json(model);
});
