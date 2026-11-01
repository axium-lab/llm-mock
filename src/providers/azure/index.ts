import express, { Router } from "express";
import { createAuthMiddleware } from "../../core/auth";
import type { Provider, ProviderDeps } from "../types";
import { azureAuthScheme } from "./auth";
import { assertApiVersion } from "./deployments";
import { filesRouter } from "../openai/routes/files";
import { responsesRouter } from "../openai/routes/responses";
import { errorHandler, notFoundHandler } from "./errors";
import { deploymentCatalogRouter, deploymentsRouter } from "./routes/deployments";
import { inferenceRouter } from "./routes/inference";
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
    // deployments — the model in the body is addressed directly. The same
    // inference handlers serve it as serve the deployment paths.
    //
    // Terminal, so an unimplemented path here 404s instead of falling through
    // to the classic tree and being told its api-version is missing.
    // Responses and Files are OpenAI's routers mounted as they are: Azure
    // proxies both to OpenAI without touching the payload, and neither sits
    // behind a deployment on either surface — the SDK sends them to
    // /openai/responses and /openai/files on the classic one, with the
    // api-version it puts on everything, and to /openai/v1/… on the other.
    const v1 = Router();
    v1.use("/models", modelsRouter);
    v1.use("/responses", responsesRouter);
    v1.use("/files", filesRouter);
    v1.use(inferenceRouter);
    v1.use(notFoundHandler);
    api.use("/v1", v1);

    // The classic surface, where every request carries ?api-version= and the
    // generative endpoints are addressed through a deployment.
    const classic = Router();
    classic.use((req, _res, next) => {
      assertApiVersion(req.query["api-version"]);
      next();
    });
    // Reading deployments comes first: `/deployments` and `/deployments/{name}`
    // are the collection, and the mount below requires a name plus a path under
    // it. Anything it does not answer falls through to the inference tree.
    classic.use("/deployments", deploymentCatalogRouter);
    classic.use("/deployments/:deployment", deploymentsRouter);
    classic.use("/models", modelsRouter);
    classic.use("/responses", responsesRouter);
    classic.use("/files", filesRouter);
    api.use(classic);

    const router = Router();
    router.use(express.json({ limit: "10mb" }));
    router.use("/openai", api);

    router.use(notFoundHandler);
    router.use(errorHandler);
    return router;
  },
};
