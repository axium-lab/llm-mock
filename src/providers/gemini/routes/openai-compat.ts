import { Router } from "express";
import { ApiError } from "../../../core/errors";
import { requestOverrides } from "../../../core/override";
import { openSSE, sendDone, sendEvent } from "../../../core/sse";
import { buildChatChunks, buildChatCompletion } from "../../openai/services/chat-completions";
import { createEmbeddings } from "../../openai/services/embeddings";
import type { ChatCompletion, ChatCompletionRequest, EmbeddingRequest } from "../../openai/types";
import { nativeDimensions } from "../services/embeddings";
import { listModels } from "../services/models";

// Google runs an OpenAI-compatible surface at /v1beta/openai, so an app built
// on the `openai` SDK can talk to Gemini by changing only its baseURL. It is a
// translation layer over the same backend, not a second API, which is why this
// router reuses OpenAI's own services rather than reimplementing them.
//
// Only what Google actually exposes is mounted. The Responses API and the
// Files endpoints are absent from the real compatibility layer, so a call to
// them 404s exactly as it would against Google — confirmed against the live
// service, along with everything else noted below.
export const openaiCompatRouter = Router();

// Errors here keep Google's envelope rather than OpenAI's. That is surprising
// but real: the layer translates requests, not failures, so a client sees
// google.rpc.Status even while reading an otherwise OpenAI-shaped API.
function contentsNotSpecified(): ApiError {
  return new ApiError(400, "* GenerateContentRequest.contents: contents is not specified\n", "INVALID_ARGUMENT");
}

// The backend that answers is Gemini's, and it does not mint OpenAI's
// `chatcmpl-` ids or report a system fingerprint.
function stripPrefix(id: string): string {
  return id.replace(/^chatcmpl-/, "");
}

function toCompatCompletion(completion: ChatCompletion): Omit<ChatCompletion, "system_fingerprint"> {
  const { system_fingerprint: _fingerprint, ...rest } = completion;
  return { ...rest, id: stripPrefix(completion.id) };
}

openaiCompatRouter.post("/chat/completions", (req, res) => {
  const body = req.body as ChatCompletionRequest;
  if (!Array.isArray(body?.messages) || body.messages.length === 0) {
    // Translated into a generateContent call before it is validated, so the
    // complaint that comes back names that request, not the OpenAI one.
    throw contentsNotSpecified();
  }

  const overrides = requestOverrides(req);
  if (body.stream) {
    openSSE(res);
    for (const chunk of buildChatChunks(body, overrides)) {
      const { system_fingerprint: _fingerprint, ...rest } = chunk;
      sendEvent(res, { ...rest, id: stripPrefix(chunk.id) });
    }
    // The [DONE] sentinel belongs here, unlike on Gemini's native stream: the
    // client is an OpenAI SDK and it waits for one.
    sendDone(res);
    return;
  }
  res.json(toCompatCompletion(buildChatCompletion(body, overrides)));
});

openaiCompatRouter.post("/embeddings", (req, res) => {
  const body = req.body as EmbeddingRequest;
  if (body?.input === undefined) throw contentsNotSpecified();
  // Gemini's own dimensions, not OpenAI's: the models being served are Gemini's.
  res.json(createEmbeddings(body, nativeDimensions));
});

// The catalog is Gemini's, dressed in OpenAI's list envelope. Ids keep the
// `models/` resource prefix, there is no `created` timestamp, and the display
// name rides along in snake_case.
interface CompatModel {
  id: string;
  object: "model";
  owned_by: "google";
  display_name: string;
}

function toCompatModel(name: string, displayName: string): CompatModel {
  return { id: name, object: "model", owned_by: "google", display_name: displayName };
}

openaiCompatRouter.get("/models", (_req, res) => {
  res.json({
    object: "list",
    data: listModels().models.map((model) => toCompatModel(model.name, model.displayName)),
  });
});

openaiCompatRouter.get("/models/{*id}", (req, res) => {
  // A client may ask by resource name or bare id; both resolve.
  const requested = ([] as string[]).concat(req.params.id ?? []).join("/");
  const model = listModels().models.find(
    (candidate) => candidate.name === requested || candidate.name === `models/${requested}`,
  );
  if (!model) {
    const name = requested.startsWith("models/") ? requested : `models/${requested}`;
    throw new ApiError(404, `Model is not found: ${name} for api version v1main`, "NOT_FOUND");
  }
  res.json(toCompatModel(model.name, model.displayName));
});
