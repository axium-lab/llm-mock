import { Router } from "express";
import { getModel, listModels, modelNotFound } from "../services/models";
import type { ModelListQuery } from "../types";

export const modelsRouter = Router();

modelsRouter.get("/", (req, res) => {
  res.json(listModels(req.query as ModelListQuery));
});

modelsRouter.get("/:id", (req, res) => {
  const model = getModel(req.params.id);
  if (!model) throw modelNotFound(req.params.id);
  res.json(model);
});
