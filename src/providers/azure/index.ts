import express, { Router } from "express";
import { createAuthMiddleware } from "../../core/auth";
import type { Provider, ProviderDeps } from "../types";
import { azureAuthScheme } from "./auth";
import { assertApiVersion } from "./deployments";
import { errorHandler, notFoundHandler } from "./errors";
import { deploymentsRouter } from "./routes/deployments";
import { modelsRouter } from "./routes/models";

export const azureProvider: Provider = {
  name: "azure",
  // Azure puts the resource name in the hostname
  // ({resource}.openai.azure.com) and keeps /openai in the path. A mock cannot
  // hand out subdomains, but it does not need to: the SDK takes an arbitrary
  // URL, so the resource simply becomes part of the prefix.
  baseURLPath: "/azure/openai",
  createRouter({ apiKeys }: ProviderDeps): Router {
    const api = Router();
    api.use(createAuthMiddleware(apiKeys, azureAuthScheme));

    // The v1 surface: OpenAI's contract verbatim, with no api-version and no
    // deployments. Terminal, so an unimplemented path here 404s instead of
    // falling through to the classic tree and being told its api-version is
    // missing.
    const v1 = Router();
    v1.use("/models", modelsRouter);
    v1.use(notFoundHandler);
    api.use("/v1", v1);

    // The classic surface, where every request carries ?api-version= and the
    // generative endpoints are addressed through a deployment.
    const classic = Router();
    classic.use((req, _res, next) => {
      assertApiVersion(req.query["api-version"]);
      next();
    });
    classic.use("/deployments/:deployment", deploymentsRouter);
    classic.use("/models", modelsRouter);
    api.use(classic);

    const router = Router();
    router.use(express.json({ limit: "10mb" }));
    router.use("/openai", api);

    router.use(notFoundHandler);
    router.use(errorHandler);
    return router;
  },
};
