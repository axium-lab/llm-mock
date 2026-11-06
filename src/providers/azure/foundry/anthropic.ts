import { randomUUID } from "node:crypto";
import express, { Router, type NextFunction, type Request, type Response } from "express";
import { createAuthMiddleware } from "../../../core/auth";
import { chaosMiddleware } from "../../../core/chaos";
import { ApiError } from "../../../core/errors";
import {
  errorHandler as anthropicErrorHandler,
  notFoundHandler as anthropicNotFoundHandler,
} from "../../anthropic/errors";
import { countTokensRouter } from "../../anthropic/routes/count-tokens";
import { messagesRouter } from "../../anthropic/routes/messages";
import { requireVersion } from "../../anthropic/version";
import type { ProviderDeps } from "../../types";
import { foundryAnthropicAuthScheme } from "../auth";
import { AzureGatewayError, errorHandler as azureErrorHandler } from "../errors";

// Claude in Microsoft Foundry: Anthropic's Messages API served from an Azure
// resource, at https://{resource}.services.ai.azure.com/anthropic/v1/*. The
// service behind that path is Anthropic's own, so the payloads, the named SSE
// events and the error envelope are the ones /anthropic already produces.
// What Azure changes is the front door — which header carries the credential,
// the gateway that rejects a bad one, and a pair of correlation headers.
//
// Not everything crosses over. Foundry offers neither the Models API nor
// Message Batches nor Files, and the Foundry SDK removes them from its client.
// They are simply not mounted here, so a request to any of them 404s the way
// it does there.

// Foundry reports two request ids: Anthropic's `request-id` — the same value
// the app already stamps as x-request-id, so header and body agree — and the
// one Azure API Management assigns on the way through.
function correlationHeaders(_req: Request, res: Response, next: NextFunction): void {
  const requestId = res.getHeader("x-request-id");
  if (requestId !== undefined) res.setHeader("request-id", requestId);
  res.setHeader("apim-request-id", randomUUID());
  next();
}

// A credential is rejected by Azure's gateway before the request reaches the
// service, so those failures come out in Azure's shapes. Everything past the
// gateway is Anthropic's envelope.
function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  if (err instanceof AzureGatewayError || (err instanceof ApiError && err.status === 401)) {
    azureErrorHandler(err, req, res, next);
    return;
  }
  anthropicErrorHandler(err, req, res, next);
}

export function createAnthropicRouter({ apiKeys }: ProviderDeps): Router {
  const v1 = Router();
  v1.use(requireVersion);
  v1.use(chaosMiddleware);
  // The literal path is registered first so it wins over the bare mount.
  v1.use("/messages/count_tokens", countTokensRouter);
  v1.use("/messages", messagesRouter);

  const router = Router();
  router.use(express.json({ limit: "32mb" }));
  router.use(createAuthMiddleware(apiKeys, foundryAnthropicAuthScheme));
  router.use(correlationHeaders);
  router.use("/v1", v1);
  router.use(anthropicNotFoundHandler);
  router.use(errorHandler);
  return router;
}
