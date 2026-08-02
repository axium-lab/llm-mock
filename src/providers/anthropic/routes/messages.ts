import { Router } from "express";
import { ApiError } from "../../../core/errors";
import { requestOverrides } from "../../../core/override";
import { openSSE, sendEvent } from "../../../core/sse";
import { buildMessage } from "../services/messages";
import { buildMessageEvents } from "../services/stream";
import type { MessageRequest } from "../types";

export const messagesRouter = Router();

// Validation messages follow the API's own field-first style
// ("max_tokens: Field required"), which is what clients see in practice.
function invalid(message: string): ApiError {
  return new ApiError(400, message, "invalid_request_error");
}

function assertRequest(body: MessageRequest): MessageRequest {
  if (typeof body?.model !== "string" || !body.model) {
    throw invalid("model: Field required");
  }
  // Required here, unlike on every other provider mocked in this repo.
  if (body.max_tokens === undefined) {
    throw invalid("max_tokens: Field required");
  }
  if (!Number.isInteger(body.max_tokens) || body.max_tokens < 1) {
    throw invalid("max_tokens: Input should be a valid integer greater than 0");
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw invalid("messages: Input should be a valid list with at least 1 item");
  }
  // A conversation opens with the user. Note that consecutive same-role
  // messages are *not* rejected — the API combines them into one turn.
  if (body.messages[0]?.role !== "user") {
    throw invalid("messages: first message must use the 'user' role");
  }
  return body;
}

messagesRouter.post("/", (req, res) => {
  const body = assertRequest(req.body as MessageRequest);
  const message = buildMessage(body, requestOverrides(req));

  if (!body.stream) {
    res.json(message);
    return;
  }

  openSSE(res);
  for (const event of buildMessageEvents(message)) {
    // The event name is not decoration here: without the `event:` line the
    // SDK reads zero chunks from the stream.
    sendEvent(res, event.data, event.name);
  }
  // No sentinel — `message_stop` above is the terminator, and the SDK errors
  // out on a stream that ends without one.
  res.end();
});
