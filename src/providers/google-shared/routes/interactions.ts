import { Router } from "express";
import { ApiError } from "../../../core/errors";
import { requestOverrides } from "../../../core/override";
import { openSSE, sendEvent } from "../../../core/sse";
import {
  buildInteraction,
  buildInteractionEvents,
  buildSyntheticInteraction,
} from "../interactions";
import type { CreateInteractionRequest } from "../types";

export const interactionsRouter = Router();

interactionsRouter.post("/", (req, res) => {
  const body = req.body as CreateInteractionRequest;
  if (!body?.model && !body?.agent) {
    throw new ApiError(400, "Either 'model' or 'agent' is required.", "invalid_request");
  }
  if (body.input === undefined) {
    throw new ApiError(400, "'input' is required.", "invalid_request");
  }

  const interaction = buildInteraction(body, requestOverrides(req));
  if (!body.stream) {
    res.json(interaction);
    return;
  }

  openSSE(res);
  for (const event of buildInteractionEvents(interaction)) {
    sendEvent(res, event);
  }
  res.end();
});

// Stateless: with no store behind it, any id resolves to a deterministic
// interaction rather than a 404, the same way GET /openai/v1/responses/{id}
// does. `?stream=true` replays it as events, which is what a client resuming a
// background interaction expects.
interactionsRouter.get("/:id", (req, res) => {
  const interaction = buildSyntheticInteraction(req.params.id);
  if (req.query.stream !== "true") {
    res.json(interaction);
    return;
  }

  openSSE(res);
  for (const event of buildInteractionEvents(interaction)) {
    sendEvent(res, event);
  }
  res.end();
});

interactionsRouter.post("/:id/cancel", (req, res) => {
  res.json(buildSyntheticInteraction(req.params.id, "cancelled"));
});

// The SDK expects 200 with no body here, so nothing is serialized. Idempotent:
// deleting an id that never existed succeeds too.
interactionsRouter.delete("/:id", (_req, res) => {
  res.status(200).end();
});
