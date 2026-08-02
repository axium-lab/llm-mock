import express, { Router } from "express";
import { createAuthMiddleware } from "../../core/auth";
import type { Provider, ProviderDeps } from "../types";
import { anthropicAuthScheme } from "./auth";
import { errorHandler, notFoundHandler } from "./errors";
import { batchesRouter } from "./routes/batches";
import { countTokensRouter } from "./routes/count-tokens";
import { filesRouter } from "./routes/files";
import { messagesRouter } from "./routes/messages";
import { modelsRouter } from "./routes/models";
import { requireVersion } from "./version";

export const anthropicProvider: Provider = {
  name: "anthropic",
  // The SDK appends only the request path, so the version segment belongs in
  // the client's baseURL — the same arrangement as the OpenAI client.
  baseURLPath: "/anthropic",
  createRouter({ apiKeys }: ProviderDeps): Router {
    const v1 = Router();
    v1.use(createAuthMiddleware(apiKeys, anthropicAuthScheme));
    v1.use(requireVersion);
    // The two sub-resources are registered first: Express matches in order, so
    // the literal paths have to win over the bare /messages mount.
    v1.use("/messages/batches", batchesRouter);
    v1.use("/messages/count_tokens", countTokensRouter);
    v1.use("/messages", messagesRouter);
    v1.use("/models", modelsRouter);
    v1.use("/files", filesRouter);

    const router = Router();
    router.use(express.json({ limit: "32mb" }));
    router.use("/v1", v1);

    router.use(notFoundHandler);
    router.use(errorHandler);
    return router;
  },
};
