import { Router } from "express";
import { ApiError } from "../../../core/errors";
import { getModel, listModels } from "../../openai/services/models";

// Azure exposes the model catalog outside the deployment path, on both
// surfaces. The catalog itself is OpenAI's — this is the same model family
// served through a different front door.
//
// Note that the real listing carries Azure-specific fields per entry
// (`capabilities`, `lifecycle_status`, `deprecation`) that are not reproduced
// here: their exact shape could not be verified against a live resource.
export const modelsRouter = Router();

modelsRouter.get("/", (_req, res) => {
  res.json(listModels());
});

modelsRouter.get("/:id", (req, res) => {
  const model = getModel(req.params.id);
  if (!model) {
    throw new ApiError(404, `The model '${req.params.id}' does not exist`, "ModelNotFound");
  }
  res.json(model);
});
