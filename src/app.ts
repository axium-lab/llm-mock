import { randomUUID } from "node:crypto";
import express, { type Express } from "express";
import { createMockAdminRouter } from "./admin/mock-admin";
import { errorHandler, notFoundHandler } from "./core/errors";
import { FixtureStore } from "./core/fixtures";
import { openaiProvider } from "./providers/openai";
import type { Provider } from "./providers/types";

export const providers: Provider[] = [openaiProvider];

export interface AppOptions {
  apiKeys: Set<string>;
}

// Builds the Express app without calling listen(), so tests can mount it on
// an ephemeral port and point the official SDKs at it via baseURL.
export function createApp({ apiKeys }: AppOptions): Express {
  const app = express();
  app.use((_req, res, next) => {
    res.setHeader("x-request-id", `req_${randomUUID().replace(/-/g, "")}`);
    next();
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  const fixtures = new FixtureStore();
  app.use("/__mock", createMockAdminRouter(fixtures));

  for (const provider of providers) {
    app.use(`/${provider.name}`, provider.createRouter({ apiKeys, fixtures }));
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
