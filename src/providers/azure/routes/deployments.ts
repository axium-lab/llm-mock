import { Router } from "express";
import { ApiError } from "../../../core/errors";
import { assertDeployment, getDeployment, listDeployments } from "../deployments";
import { inferenceRouter } from "./inference";

// The collection itself: `/openai/deployments` with no name after it, which the
// deployment-scoped mount below cannot serve because its `:deployment` param is
// required. Mounted ahead of that one so the two GETs here win over it; every
// other method and any deeper path falls through to inference.
export const deploymentCatalogRouter = Router();

deploymentCatalogRouter.get("/", (_req, res) => {
  res.json(listDeployments());
});

deploymentCatalogRouter.get("/:deployment", (req, res) => {
  res.json(getDeployment(req.params.deployment));
});

// Everything addressed as /openai/deployments/{deployment}/… lands here. Only
// a fixed set of endpoints is deployment-scoped on Azure — chat/completions,
// completions, embeddings, audio/*, images/* and batches — which is why the
// rest of the classic surface is mounted alongside this router rather than
// inside it.
//
// mergeParams so the deployment captured by the mount is visible.
export const deploymentsRouter = Router({ mergeParams: true });

// The deployment is resolved before anything else: on the real service a name
// that does not exist fails ahead of any body validation.
deploymentsRouter.use((req, _res, next) => {
  assertDeployment((req.params as { deployment?: string }).deployment ?? "");
  next();
});

deploymentsRouter.use(inferenceRouter);

// A deployment-scoped path this mock does not serve — audio, images, batches.
deploymentsRouter.use((req, _res) => {
  throw new ApiError(404, `Resource not found: ${req.method} ${req.baseUrl}${req.path}`, "404");
});
