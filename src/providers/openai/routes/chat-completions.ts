import { Router } from "express";
import { ApiError } from "../../../core/errors";
import { openSSE, sendDone, sendEvent } from "../../../core/sse";
import { buildChatChunks, buildChatCompletion } from "../services/chat-completions";
import type { ChatCompletionRequest } from "../types";

export const chatCompletionsRouter = Router();

chatCompletionsRouter.post("/", (req, res) => {
  const body = req.body as ChatCompletionRequest;
  if (typeof body.model !== "string" || !body.model) {
    throw new ApiError(400, "you must provide a model parameter", null, "model");
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw new ApiError(400, "'messages' must be a non-empty array.", null, "messages");
  }

  if (body.stream) {
    openSSE(res);
    for (const chunk of buildChatChunks(body)) {
      sendEvent(res, chunk);
    }
    sendDone(res);
    return;
  }
  res.json(buildChatCompletion(body));
});
