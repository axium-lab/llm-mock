import { Router } from "express";
import { ApiError } from "../../../core/errors";
import type { FixtureStore } from "../../../core/fixtures";
import { openSSE, sendEvent } from "../../../core/sse";
import { buildResponse, buildResponseEvents, ResponseStore } from "../services/responses";
import type { ResponseRequest } from "../types";

export function createResponsesRouter(fixtures: FixtureStore): Router {
  const store = new ResponseStore();
  const router = Router();

  router.post("/", (req, res) => {
    const body = req.body as ResponseRequest;
    if (typeof body.model !== "string" || !body.model) {
      throw new ApiError(400, "you must provide a model parameter", null, "model");
    }
    if (body.input === undefined) {
      throw new ApiError(400, "Missing required parameter: 'input'.", "missing_required_parameter", "input");
    }

    const response = buildResponse(fixtures, body);
    store.save(response);

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

  router.get("/:id", (req, res) => {
    const response = store.get(req.params.id);
    if (!response) {
      throw new ApiError(404, `Response with id '${req.params.id}' not found.`, null, "id");
    }
    res.json(response);
  });

  router.delete("/:id", (req, res) => {
    if (!store.delete(req.params.id)) {
      throw new ApiError(404, `Response with id '${req.params.id}' not found.`, null, "id");
    }
    res.json({ id: req.params.id, object: "response", deleted: true });
  });

  return router;
}
