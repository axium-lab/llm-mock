import { Router } from "express";
import { ApiError } from "../../../core/errors";
import { assertDeployment } from "../deployments";

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

// Filled in by the next phase. Until then the answer names the path that was
// attempted, rather than a bare 404.
deploymentsRouter.use((req, _res) => {
  throw new ApiError(
    404,
    `Resource not found: ${req.method} ${req.baseUrl}${req.path}`,
    "404",
  );
});
