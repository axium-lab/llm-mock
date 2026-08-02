import { Router } from "express";
import { ApiError } from "../../../core/errors";
import { requestOverrides } from "../../../core/override";
import { openSSE, sendEvent } from "../../../core/sse";
import { parseRpcTarget } from "../rpc-path";
import {
  buildGenerateContentChunks,
  buildGenerateContentResponse,
  normalizeContents,
} from "../services/generate-content";
import { getModel, listModels, modelNotFound } from "../services/models";
import type { GenerateContentRequest } from "../types";

export const modelsRouter = Router();

modelsRouter.get("/", (_req, res) => {
  res.json(listModels());
});

// `:target` captures the whole segment, method suffix included, because a
// custom method travels as `gemini-3.6-flash:generateContent`.
modelsRouter.get("/:target", (req, res) => {
  const { resource, method } = parseRpcTarget(req.params.target);
  const model = getModel(resource);
  if (!model) throw modelNotFound(resource, method ?? "GET");
  res.json(model);
});

// Reproduces the real API's complaint for a request with nothing to answer.
function assertContents(body: GenerateContentRequest): GenerateContentRequest {
  if (normalizeContents(body?.contents).length === 0) {
    throw new ApiError(400, "* GenerateContentRequest.contents: contents is not specified\n");
  }
  return body;
}

// Custom methods on the models resource. The model id is not checked against
// the catalog here, matching how the OpenAI provider accepts any model on
// chat/completions: tests name models this mock has never heard of.
modelsRouter.post("/:target", (req, res) => {
  const { resource, method } = parseRpcTarget(req.params.target);
  const body = req.body as GenerateContentRequest;
  const overrides = requestOverrides(req);

  switch (method) {
    case "generateContent":
      res.json(buildGenerateContentResponse(resource, assertContents(body), overrides));
      return;

    case "streamGenerateContent": {
      const chunks = buildGenerateContentChunks(resource, assertContents(body), overrides);
      // Without ?alt=sse the real API streams a JSON array instead of events.
      if (req.query.alt !== "sse") {
        res.json(chunks);
        return;
      }
      openSSE(res);
      for (const chunk of chunks) {
        sendEvent(res, chunk);
      }
      // No [DONE] sentinel: the SDK parses every event as JSON and rejects a
      // trailing one it cannot parse.
      res.end();
      return;
    }

    default:
      throw modelNotFound(resource, method ?? "POST");
  }
});

// models.list({ config: { queryBase: false } }) reads this collection instead
// of /models, so it has to exist. This mock never mints tuned models.
export const tunedModelsRouter = Router();

tunedModelsRouter.get("/", (_req, res) => {
  res.json({ tunedModels: [] });
});
