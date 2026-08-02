import { randomUUID } from "node:crypto";
import express, { type Express } from "express";
import pkg from "../package.json" with { type: "json" };
import { errorHandler, notFoundHandler } from "./core/errors";
import { anthropicProvider } from "./providers/anthropic";
import { azureProvider } from "./providers/azure";
import { geminiProvider } from "./providers/gemini";
import { geminiEnterpriseProvider } from "./providers/gemini-enterprise";
import { openaiProvider } from "./providers/openai";
import type { Provider } from "./providers/types";

export const providers: Provider[] = [
  openaiProvider,
  geminiProvider,
  geminiEnterpriseProvider,
  azureProvider,
  anthropicProvider,
];

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

  // The version is read from package.json so a running container can be
  // matched against the release and image tag it was built from.
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", version: pkg.version });
  });
  for (const provider of providers) {
    app.use(`/${provider.name}`, provider.createRouter({ apiKeys }));
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
