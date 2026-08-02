import express, { Router } from "express";
import { createAuthMiddleware } from "../../core/auth";
import type { Provider, ProviderDeps } from "../types";
import { geminiAuthScheme } from "./auth";
import { errorHandler, notFoundHandler } from "./errors";
import { interactionsRouter } from "./routes/interactions";
import { modelsRouter, tunedModelsRouter } from "./routes/models";

export const geminiProvider: Provider = {
  name: "gemini",
  // Unlike the OpenAI SDK, @google/genai appends the version segment itself
  // (httpOptions.apiVersion, "v1beta" by default), so clients point their
  // baseUrl at the bare prefix.
  baseURLPath: "/gemini",
  createRouter({ apiKeys }: ProviderDeps): Router {
    const api = Router();
    api.use(createAuthMiddleware(apiKeys, geminiAuthScheme));
    api.use("/models", modelsRouter);
    api.use("/tunedModels", tunedModelsRouter);
    api.use("/interactions", interactionsRouter);

    const router = Router();
    router.use(express.json({ limit: "10mb" }));
    // Both versions serve the same mock: which one a client talks to is a
    // config flag on its side, and 404-ing the other one only ever surprises.
    router.use("/v1beta", api);
    router.use("/v1", api);

    router.use(notFoundHandler);
    router.use(errorHandler);
    return router;
  },
};
