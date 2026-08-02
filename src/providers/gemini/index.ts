import express, { Router } from "express";
import { createAuthMiddleware } from "../../core/auth";
import type { Provider, ProviderDeps } from "../types";
import { geminiAuthScheme } from "./auth";
import { errorHandler, notFoundHandler } from "./errors";
import { filesRouter, uploadRouter } from "./routes/files";
import { interactionsRouter } from "./routes/interactions";
import { modelsRouter, tunedModelsRouter } from "./routes/models";
import { openaiCompatRouter } from "./routes/openai-compat";

// Generous enough for the media this API is meant to carry, without letting a
// runaway request buffer without bound.
const MAX_UPLOAD = "100mb";

export const geminiProvider: Provider = {
  name: "gemini",
  // Unlike the OpenAI SDK, @google/genai appends the version segment itself
  // (httpOptions.apiVersion, "v1beta" by default), so clients point their
  // baseUrl at the bare prefix.
  baseURLPath: "/gemini",
  createRouter({ apiKeys }: ProviderDeps): Router {
    const auth = createAuthMiddleware(apiKeys, geminiAuthScheme);

    const api = Router();
    api.use(auth);
    api.use("/models", modelsRouter);
    api.use("/tunedModels", tunedModelsRouter);
    api.use("/interactions", interactionsRouter);
    api.use("/files", filesRouter);
    // Registered last so the native surface always wins a path collision.
    api.use("/openai", openaiCompatRouter);

    const router = Router();

    // Uploads sit under /upload, ahead of the version segment, and the client
    // addresses them as upload/v1beta/files whatever apiVersion it is
    // otherwise using. Their bytes arrive under an application/json content
    // type, so they must be read raw before the JSON parser sees them —
    // otherwise the file's own contents get parsed as a JSON body.
    //
    // `type: () => true` rather than a content-type pattern: on this endpoint
    // the body is opaque bytes whatever the header claims, and matching by
    // pattern silently drops the ones it does not recognize.
    router.use("/upload/v1beta/files", auth, express.raw({ type: () => true, limit: MAX_UPLOAD }), uploadRouter);

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
