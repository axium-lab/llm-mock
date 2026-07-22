import { randomUUID } from "node:crypto";
import express, { Router, type Express } from "express";
import { createAuthMiddleware } from "./middleware/auth";
import { errorHandler, notFoundHandler } from "./middleware/error-handler";
import { chatCompletionsRouter } from "./routes/chat-completions";
import { embeddingsRouter } from "./routes/embeddings";
import { mockAdminRouter } from "./routes/mock-admin";
import { modelsRouter } from "./routes/models";
import { responsesRouter } from "./routes/responses";

export interface AppOptions {
  apiKeys: Set<string>;
}

// Builds the Express app without calling listen(), so tests can mount it on
// an ephemeral port and point the official SDK at it via baseURL.
export function createApp({ apiKeys }: AppOptions): Express {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use((_req, res, next) => {
    res.setHeader("x-request-id", `req_${randomUUID().replace(/-/g, "")}`);
    next();
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  app.use("/__mock", mockAdminRouter);

  const v1 = Router();
  v1.use(createAuthMiddleware(apiKeys));
  v1.use("/chat/completions", chatCompletionsRouter);
  v1.use("/responses", responsesRouter);
  v1.use("/models", modelsRouter);
  v1.use("/embeddings", embeddingsRouter);
  app.use("/v1", v1);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
