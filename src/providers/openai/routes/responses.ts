import { Router } from "express";
import { ApiError } from "../../../core/errors";
import { responseOverride } from "../../../core/override";
import { openSSE, sendEvent } from "../../../core/sse";
import { buildResponse, buildResponseEvents, buildSyntheticResponse } from "../services/responses";
import type { ResponseRequest } from "../types";

export const responsesRouter = Router();

responsesRouter.post("/", (req, res) => {
  const body = req.body as ResponseRequest;
  if (typeof body.model !== "string" || !body.model) {
    throw new ApiError(400, "you must provide a model parameter", null, "model");
  }
  if (body.input === undefined) {
    throw new ApiError(400, "Missing required parameter: 'input'.", "missing_required_parameter", "input");
  }

  const response = buildResponse(body, responseOverride(req));

  if (body.stream) {
    openSSE(res);
    for (const event of buildResponseEvents(response)) {
      sendEvent(res, event, event.type);
    }
    res.end();
    return;
  }
  res.json(response);
});

// Stateless: there is no store, so retrieval synthesizes a deterministic
// response for whatever id is asked, and deletion is always idempotent.
responsesRouter.get("/:id", (req, res) => {
  res.json(buildSyntheticResponse(req.params.id));
});

responsesRouter.delete("/:id", (req, res) => {
  res.json({ id: req.params.id, object: "response", deleted: true });
});
