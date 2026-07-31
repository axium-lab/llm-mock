import express, { Router } from "express";
import { createAuthMiddleware } from "../../core/auth";
import type { Provider, ProviderDeps } from "../types";
import { openaiAuthScheme } from "./auth";
import { errorHandler, notFoundHandler } from "./errors";
import { chatCompletionsRouter } from "./routes/chat-completions";
import { embeddingsRouter } from "./routes/embeddings";
import { filesRouter } from "./routes/files";
import { modelsRouter } from "./routes/models";
import { responsesRouter } from "./routes/responses";
import { uploadsRouter } from "./routes/uploads";

export const openaiProvider: Provider = {
  name: "openai",
  baseURLPath: "/openai/v1",
  createRouter({ apiKeys }: ProviderDeps): Router {
    const v1 = Router();
    v1.use(createAuthMiddleware(apiKeys, openaiAuthScheme));
    v1.use("/chat/completions", chatCompletionsRouter);
    v1.use("/responses", responsesRouter);
    v1.use("/models", modelsRouter);
    v1.use("/embeddings", embeddingsRouter);
    v1.use("/files", filesRouter);
    v1.use("/uploads", uploadsRouter);

    const router = Router();
    router.use(express.json({ limit: "10mb" }));
    router.use("/v1", v1);
    router.use(notFoundHandler);
    router.use(errorHandler);
    return router;
  },
};
