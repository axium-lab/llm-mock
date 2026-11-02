import { Router } from "express";
import { ApiError } from "../../../core/errors";
import { requestOverrides } from "../../../core/override";
import { openSSE, sendDone, sendEvent } from "../../../core/sse";
import { buildCompletion, buildCompletionChunks } from "../services/completions";
import type { CompletionRequest } from "../types";

// The legacy endpoint, kept because the instruct models still answer on it
// and some code never moved. A missing prompt is allowed, as on the real API.
export const completionsRouter = Router();

completionsRouter.post("/", (req, res) => {
  const body = req.body as CompletionRequest;
  if (typeof body.model !== "string" || !body.model) {
    throw new ApiError(400, "you must provide a model parameter", null, "model");
  }

  const overrides = requestOverrides(req);
  if (body.stream) {
    openSSE(res);
    for (const chunk of buildCompletionChunks(body, overrides)) {
      sendEvent(res, chunk);
    }
    sendDone(res);
    return;
  }
  res.json(buildCompletion(body, overrides));
});
