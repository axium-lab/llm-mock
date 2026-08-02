import { Router } from "express";
import { ApiError } from "../../../core/errors";
import { requestOverrides } from "../../../core/override";
import { openSSE, sendEvent } from "../../../core/sse";
import { normalizeContents } from "../../google-shared/generate-content";
import { parseRpcTarget } from "../../google-shared/rpc-path";
import type { GenerateContentRequest } from "../../google-shared/types";
import {
  buildVertexGenerateContentChunks,
  buildVertexGenerateContentResponse,
} from "../services/generate-content";
import { getPublisherModel, listPublisherModels, modelNotFound } from "../services/models";

// mergeParams so the regional mount can see the project and location it
// captured; on the express mount both are simply absent.
export const publisherModelsRouter = Router({ mergeParams: true });

// Listing is global on this platform: the SDK asks for it without a project or
// a location even when every other call carries them.
publisherModelsRouter.get("/", (_req, res) => {
  res.json(listPublisherModels());
});

// `:target` captures the whole segment, method suffix included, because a
// custom method travels as `gemini-3.6-flash:generateContent`.
publisherModelsRouter.get("/:target", (req, res) => {
  const { resource, method } = parseRpcTarget(req.params.target);
  const model = getPublisherModel(resource);
  if (!model) throw modelNotFound(resource, method ?? "GET");
  res.json(model);
});

// Reproduces the platform's complaint for a request with nothing to answer.
function assertContents(body: GenerateContentRequest): GenerateContentRequest {
  if (normalizeContents(body?.contents).length === 0) {
    throw new ApiError(400, "* GenerateContentRequest.contents: contents is not specified\n", "INVALID_ARGUMENT");
  }
  return body;
}

// Custom methods land here, on both the regional and the express mount. The
// model id is not checked against the catalog, matching how the other two
// providers accept any model on their generative endpoints.
publisherModelsRouter.post("/:target", (req, res) => {
  const { resource, method } = parseRpcTarget(req.params.target);
  const body = req.body as GenerateContentRequest;
  const overrides = requestOverrides(req);

  switch (method) {
    case "generateContent":
      res.json(buildVertexGenerateContentResponse(resource, assertContents(body), overrides));
      return;

    case "streamGenerateContent": {
      const chunks = buildVertexGenerateContentChunks(resource, assertContents(body), overrides);
      // Without ?alt=sse the platform streams a JSON array instead of events.
      if (req.query.alt !== "sse") {
        res.json(chunks);
        return;
      }
      openSSE(res);
      for (const chunk of chunks) {
        sendEvent(res, chunk);
      }
      // No [DONE] sentinel: the SDK parses every event as JSON.
      res.end();
      return;
    }

    default:
      throw modelNotFound(resource, method ?? "POST");
  }
});
