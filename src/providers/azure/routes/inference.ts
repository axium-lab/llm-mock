import { Router } from "express";
import { ApiError } from "../../../core/errors";
import { requestOverrides } from "../../../core/override";
import { openSSE, sendDone, sendEvent } from "../../../core/sse";
import { buildChatChunks, buildChatCompletion } from "../../openai/services/chat-completions";
import { createEmbeddings } from "../../openai/services/embeddings";
import type { ChatCompletionRequest, EmbeddingRequest } from "../../openai/types";

// The generative endpoints. Azure serves OpenAI's models through its own front
// door, so the payloads are OpenAI's verbatim and these handlers are a thin
// shell over that provider's services — what differs is everything around
// them: the path, the credential, the error envelope.
//
// Mounted twice: once behind a deployment on the classic surface, once
// directly under /v1. mergeParams so the deployment stays visible.
export const inferenceRouter = Router({ mergeParams: true });

inferenceRouter.post("/chat/completions", (req, res) => {
  const body = req.body as ChatCompletionRequest;
  if (typeof body?.model !== "string" || !body.model) {
    throw new ApiError(400, "you must provide a model parameter", "BadRequest", "model");
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw new ApiError(400, "'messages' must be a non-empty array.", "BadRequest", "messages");
  }

  const overrides = requestOverrides(req);
  if (body.stream) {
    openSSE(res);
    for (const chunk of buildChatChunks(body, overrides)) {
      sendEvent(res, chunk);
    }
    // Azure terminates the stream with the same [DONE] sentinel as OpenAI.
    sendDone(res);
    return;
  }
  res.json(buildChatCompletion(body, overrides));
});

inferenceRouter.post("/embeddings", (req, res) => {
  const body = req.body as EmbeddingRequest;
  if (typeof body?.model !== "string" || !body.model) {
    throw new ApiError(400, "you must provide a model parameter", "BadRequest", "model");
  }
  if (body.input === undefined) {
    throw new ApiError(400, "Missing required parameter: 'input'.", "BadRequest", "input");
  }
  res.json(createEmbeddings(body));
});
