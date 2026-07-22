import { Router } from "express";
import type { Provider, ProviderDeps } from "../types";
import { createAuthMiddleware } from "./auth";
import { chatCompletionsRouter } from "./routes/chat-completions";
import { embeddingsRouter } from "./routes/embeddings";
import { modelsRouter } from "./routes/models";
import { responsesRouter } from "./routes/responses";

export const openaiProvider: Provider = {
  name: "openai",
  createRouter({ apiKeys }: ProviderDeps): Router {
    const v1 = Router();
    v1.use(createAuthMiddleware(apiKeys));
    v1.use("/chat/completions", chatCompletionsRouter);
    v1.use("/responses", responsesRouter);
    v1.use("/models", modelsRouter);
    v1.use("/embeddings", embeddingsRouter);

    const router = Router();
    router.use("/v1", v1);
    return router;
  },
};
