import { Router } from "express";
import { ApiError } from "../../../core/errors";
import { requestOverrides } from "../../../core/override";
import { openSSE, sendDone, sendEvent } from "../../../core/sse";
import { errorHandler, notFoundHandler } from "../../openai/errors";
import { buildChatChunks, buildChatCompletion } from "../../openai/services/chat-completions";
import { createEmbeddings } from "../../openai/services/embeddings";
import type { ChatCompletionRequest, EmbeddingRequest, Model } from "../../openai/types";
import { deterministicCreated } from "../../../core/ids";
import { nativeDimensions } from "../services/embeddings";
import { listModels } from "../services/models";

// Google runs an OpenAI-compatible surface at /v1beta/openai, so an app built
// on the `openai` SDK can talk to Gemini by changing only its baseURL. It is a
// genuine translation layer, not a second API: the request and response shapes
// are OpenAI's, which is why this router reuses OpenAI's own services rather
// than reimplementing them.
//
// Only what Google actually exposes is mounted here. The Responses API and the
// Files/Uploads endpoints are absent from the real compatibility layer, so a
// call to them 404s exactly as it would against Google.
export const openaiCompatRouter = Router();

openaiCompatRouter.post("/chat/completions", (req, res) => {
  const body = req.body as ChatCompletionRequest;
  if (typeof body.model !== "string" || !body.model) {
    throw new ApiError(400, "you must provide a model parameter", null, "model");
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw new ApiError(400, "'messages' must be a non-empty array.", null, "messages");
  }

  const overrides = requestOverrides(req);
  if (body.stream) {
    openSSE(res);
    for (const chunk of buildChatChunks(body, overrides)) {
      sendEvent(res, chunk);
    }
    // The [DONE] sentinel belongs here, unlike on Gemini's native stream: the
    // client is an OpenAI SDK and it waits for one.
    sendDone(res);
    return;
  }
  res.json(buildChatCompletion(body, overrides));
});

openaiCompatRouter.post("/embeddings", (req, res) => {
  const body = req.body as EmbeddingRequest;
  if (typeof body.model !== "string" || !body.model) {
    throw new ApiError(400, "you must provide a model parameter", null, "model");
  }
  if (body.input === undefined) {
    throw new ApiError(400, "Missing required parameter: 'input'.", "missing_required_parameter", "input");
  }
  // Gemini's own dimensions, not OpenAI's: the models being served are Gemini's.
  res.json(createEmbeddings(body, nativeDimensions));
});

// The catalog is Gemini's, dressed in OpenAI's list envelope. Ids keep the
// `models/` resource prefix the way Google reports them.
function toOpenAIModel(name: string): Model {
  return { id: name, object: "model", created: deterministicCreated(name), owned_by: "google" };
}

openaiCompatRouter.get("/models", (_req, res) => {
  res.json({ object: "list", data: listModels().models.map((model) => toOpenAIModel(model.name)) });
});

openaiCompatRouter.get("/models/{*id}", (req, res) => {
  // A client may ask by resource name or bare id; both resolve.
  const requested = ([] as string[]).concat(req.params.id ?? []).join("/");
  const model = listModels().models.find(
    (candidate) => candidate.name === requested || candidate.name === `models/${requested}`,
  );
  if (!model) {
    throw new ApiError(404, `The model '${requested}' does not exist`, "model_not_found", "model");
  }
  res.json(toOpenAIModel(model.name));
});

// OpenAI's envelope for everything raised inside this router, because the
// client reading it is an OpenAI SDK. Authentication is the exception: it is
// checked upstream by Google's frontend, and fails with Google's envelope.
openaiCompatRouter.use(notFoundHandler);
openaiCompatRouter.use(errorHandler);
