import express, { Router } from "express";
import { createAuthMiddleware } from "../../core/auth";
import { interactionsRouter } from "../google-shared/routes/interactions";
import type { Provider, ProviderDeps } from "../types";
import { geminiEnterpriseAuthScheme } from "./auth";
import { errorHandler, notFoundHandler } from "./errors";
import { publisherModelsRouter } from "./routes/models";
import { assertScope } from "./scope";

const PUBLISHER_PATH = "/publishers/google/models";
const REGIONAL_PATH = `/projects/:project/locations/:location${PUBLISHER_PATH}`;

export const geminiEnterpriseProvider: Provider = {
  name: "gemini-enterprise",
  // As with the AI Studio provider, @google/genai appends the version segment
  // itself, so clients point their baseUrl at the bare prefix. Note that in
  // regional mode the SDK folds the project and location into that segment
  // too, producing `v1beta1/projects/{p}/locations/{l}`.
  baseURLPath: "/gemini-enterprise",
  createRouter({ apiKeys }: ProviderDeps): Router {
    const api = Router();
    api.use(createAuthMiddleware(apiKeys, geminiEnterpriseAuthScheme));

    // The same router answers both shapes. Regional callers — the ones using
    // OAuth — carry a project and a location; express-mode callers, holding
    // only an API key, address the publisher models directly.
    api.use(REGIONAL_PATH, publisherModelsRouter);
    api.use(PUBLISHER_PATH, publisherModelsRouter);

    // Interactions cannot hang off the version mounts below: in regional mode
    // the SDK percent-encodes the whole version-and-location component into a
    // single path segment, which a literal "/v1beta1" mount never matches. A
    // route parameter does, and arrives decoded — see ./scope.
    const interactions = Router({ mergeParams: true });
    interactions.use(createAuthMiddleware(apiKeys, geminiEnterpriseAuthScheme));
    interactions.use((req, _res, next) => {
      assertScope((req.params as { scope?: string }).scope);
      next();
    });
    interactions.use(interactionsRouter);

    const router = Router();
    router.use(express.json({ limit: "10mb" }));
    router.use("/:scope/interactions", interactions);
    // v1beta1 is what the SDK defaults to here, unlike AI Studio's v1beta.
    router.use("/v1beta1", api);
    router.use("/v1", api);

    router.use(notFoundHandler);
    router.use(errorHandler);
    return router;
  },
};
