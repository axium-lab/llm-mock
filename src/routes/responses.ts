import { Router } from "express";
import { ApiError } from "../middleware/error-handler";
import { openSSE, sendEvent } from "../core/streaming";
import {
  buildResponse,
  buildResponseEvents,
  deleteResponse,
  getResponse,
  saveResponse,
} from "../services/responses";
import type { ResponseRequest } from "../types/openai";

export const responsesRouter = Router();

responsesRouter.post("/", (req, res) => {
  const body = req.body as ResponseRequest;
  if (typeof body.model !== "string" || !body.model) {
    throw new ApiError(400, "you must provide a model parameter", "invalid_request_error", null, "model");
  }
  if (body.input === undefined) {
    throw new ApiError(400, "Missing required parameter: 'input'.", "invalid_request_error", "missing_required_parameter", "input");
  }

  const response = buildResponse(body);
  saveResponse(response);

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

responsesRouter.get("/:id", (req, res) => {
  const response = getResponse(req.params.id);
  if (!response) {
    throw new ApiError(404, `Response with id '${req.params.id}' not found.`, "invalid_request_error", null, "id");
  }
  res.json(response);
});

responsesRouter.delete("/:id", (req, res) => {
  if (!deleteResponse(req.params.id)) {
    throw new ApiError(404, `Response with id '${req.params.id}' not found.`, "invalid_request_error", null, "id");
  }
  res.json({ id: req.params.id, object: "response", deleted: true });
});
