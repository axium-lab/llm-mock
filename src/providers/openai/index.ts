import express, { Router } from "express";
import { createAuthMiddleware } from "../../core/auth";
import type { Provider, ProviderDeps } from "../types";
import { openaiAuthScheme } from "./auth";
import { errorHandler, notFoundHandler } from "./errors";
import { createChatCompletionsRouter } from "./routes/chat-completions";
import { embeddingsRouter } from "./routes/embeddings";
import { modelsRouter } from "./routes/models";
import { createResponsesRouter } from "./routes/responses";

export const openaiProvider: Provider = {
  name: "openai",
  createRouter({ apiKeys, fixtures }: ProviderDeps): Router {
    const v1 = Router();
    v1.use(createAuthMiddleware(apiKeys, openaiAuthScheme));
    v1.use("/chat/completions", createChatCompletionsRouter(fixtures));
    v1.use("/responses", createResponsesRouter(fixtures));
    v1.use("/models", modelsRouter);
    v1.use("/embeddings", embeddingsRouter);

    const router = Router();
    router.use(express.json({ limit: "10mb" }));
    router.use("/v1", v1);
    router.use(notFoundHandler);
    router.use(errorHandler);
    return router;
  },
};
