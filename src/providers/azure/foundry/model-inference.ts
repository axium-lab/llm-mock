import express, { Router, type NextFunction, type Request, type Response } from "express";
import { createAuthMiddleware } from "../../../core/auth";
import { ApiError } from "../../../core/errors";
import { deterministicId } from "../../../core/ids";
import { requestOverrides } from "../../../core/override";
import { openSSE, sendDone, sendEvent } from "../../../core/sse";
import { buildChatChunks, buildChatCompletion } from "../../openai/services/chat-completions";
import { createEmbeddings } from "../../openai/services/embeddings";
import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionRequest,
  EmbeddingRequest,
  ToolCall,
} from "../../openai/types";
import type { ProviderDeps } from "../../types";
import { azureAuthScheme } from "../auth";
import { blocksCompletion, contentFilterOverride } from "../content-filter";
import { assertApiVersion } from "../deployments";
import { AzureGatewayError, errorHandler as azureErrorHandler } from "../errors";
import { filteredChunks } from "../routes/inference";

// The Azure AI Model Inference API: the route Foundry exposes for models that
// are not OpenAI's — Llama, Mistral, DeepSeek, Phi — at
// https://{resource}.services.ai.azure.com/models/*. Its request and response
// shapes are OpenAI's chat completions and embeddings pared down to a common
// subset, with a flat error envelope of its own and a header,
// `extra-parameters`, deciding what happens to a field outside that subset.
//
// Microsoft now steers Foundry Models through /openai/v1 instead and has
// retired the azure-ai-inference SDKs; this door exists for the code written
// against them. Its shapes come from the SDK's type definitions and the
// published reference, not from a live resource.

// What the endpoint says about the model deployed behind it. /info was
// designed for a single-model endpoint; on a Foundry resource the answer
// depends on a deployment this mock does not have, so it is fixed.
export const DEPLOYED_MODEL = {
  model_name: "Phi-4",
  model_type: "chat_completion",
  model_provider_name: "Microsoft",
} as const;

// The envelope is flat — no `error` wrapper — and carries the status again in
// the body. A validation failure points at the offending field through
// `detail.loc`, FastAPI-style; a filtered prompt names `param` and a null
// `type`, in the OpenAI manner.
interface ModelInferenceExtra {
  type?: null;
  detail?: { loc: string[]; input: unknown };
}

class ModelInferenceError extends ApiError {
  constructor(
    status: number,
    message: string,
    code: string,
    param: string | null = null,
    readonly extra: ModelInferenceExtra = {},
  ) {
    super(status, message, code, param);
  }
}

// The fields the API specifies for each operation. Anything else is an "extra
// parameter", and `extra-parameters` decides its fate: `error` (the default)
// rejects the request, `drop` discards the field, `pass-through` hands it to
// the model. The mock has no model to hand it to, so the last two are the same
// thing here.
const CHAT_PARAMETERS = new Set([
  "messages",
  "model",
  "frequency_penalty",
  "max_tokens",
  "modalities",
  "audio",
  "presence_penalty",
  "response_format",
  "seed",
  "stop",
  "stream",
  "stream_options",
  "temperature",
  "tool_choice",
  "tools",
  "top_p",
]);
const EMBEDDING_PARAMETERS = new Set(["input", "model", "dimensions", "encoding_format", "input_type"]);

function assertKnownParameters(req: Request, body: Record<string, unknown>, known: Set<string>): void {
  const mode = req.headers["extra-parameters"];
  if (mode === "drop" || mode === "pass-through") return;
  for (const key of Object.keys(body ?? {})) {
    if (!known.has(key)) {
      throw new ModelInferenceError(422, "One of the parameters contain invalid values.", "parameter_not_supported", null, {
        detail: { loc: ["body", key], input: body[key] },
      });
    }
  }
}

function missing(field: string): ModelInferenceError {
  return new ModelInferenceError(422, "One of the parameters contain invalid values.", "missing", null, {
    detail: { loc: ["body", field], input: null },
  });
}

// A prompt blocked by Azure AI Content Safety fails the whole call, in the
// documented shape.
function contentFiltered(): ModelInferenceError {
  return new ModelInferenceError(400, "The response was filtered", "content_filter", "messages", { type: null });
}

// The model is optional: a single-model endpoint has nothing to choose, and the
// response names what it ran.
function modelOf(body: { model?: unknown }): string {
  return typeof body?.model === "string" && body.model ? body.model : DEPLOYED_MODEL.model_name;
}

// The response is OpenAI's with the fields this API does not specify removed —
// no `object`, no `system_fingerprint`, and a message of role, content and
// tool calls only.
interface InferenceChoice {
  index: number;
  finish_reason: string | null;
  message: { role: "assistant"; content: string | null; tool_calls?: ToolCall[] };
}

function toInferenceCompletion(completion: ChatCompletion, filtered: boolean) {
  return {
    id: completion.id,
    created: completion.created,
    model: completion.model,
    choices: completion.choices.map(
      (choice): InferenceChoice => ({
        index: choice.index,
        finish_reason: filtered ? "content_filter" : choice.finish_reason,
        message: {
          role: "assistant",
          content: filtered ? null : choice.message.content,
          ...(choice.message.tool_calls ? { tool_calls: choice.message.tool_calls } : {}),
        },
      }),
    ),
    usage: completion.usage,
  };
}

function toInferenceChunk(chunk: ChatCompletionChunk) {
  return {
    id: chunk.id,
    created: chunk.created,
    model: chunk.model,
    choices: chunk.choices.map(({ index, delta, finish_reason }) => ({ index, delta, finish_reason })),
    ...(chunk.usage ? { usage: chunk.usage } : {}),
  };
}

function envelope(err: ApiError) {
  const extra = err instanceof ModelInferenceError ? err.extra : {};
  return {
    status: err.status,
    code: err.code ?? String(err.status),
    message: err.message,
    ...(err.param === null ? {} : { param: err.param }),
    ...("type" in extra ? { type: extra.type } : {}),
    ...(extra.detail === undefined ? {} : { detail: extra.detail }),
  };
}

// An unknown path is refused by API Management, which answers in its own flat
// shape — the same one a missing credential gets.
function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ statusCode: 404, message: "Resource not found" });
}

function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  // Credentials are checked by the gateway, ahead of the service.
  if (err instanceof AzureGatewayError || (err instanceof ApiError && err.status === 401)) {
    azureErrorHandler(err, req, res, next);
    return;
  }
  if (err instanceof ApiError) {
    res.status(err.status).json(envelope(err));
    return;
  }
  const message = err instanceof Error ? err.message : "Internal server error";
  res.status(500).json({ status: 500, code: "InternalServerError", message });
}

export function createModelInferenceRouter({ apiKeys }: ProviderDeps): Router {
  const router = Router();
  router.use(express.json({ limit: "10mb" }));
  router.use(createAuthMiddleware(apiKeys, azureAuthScheme));
  // Versioned by query parameter like the classic Azure OpenAI surface, and
  // just as strict about its absence.
  router.use((req, _res, next) => {
    assertApiVersion(req.query["api-version"]);
    next();
  });

  router.get("/info", (_req, res) => {
    res.json(DEPLOYED_MODEL);
  });

  router.post("/chat/completions", (req, res) => {
    const body = req.body as ChatCompletionRequest;
    assertKnownParameters(req, body, CHAT_PARAMETERS);
    if (!Array.isArray(body?.messages) || body.messages.length === 0) throw missing("messages");

    const filter = contentFilterOverride(req);
    if (filter?.target === "prompt") throw contentFiltered();

    const request = { ...body, model: modelOf(body) };
    const overrides = requestOverrides(req);
    if (body.stream) {
      openSSE(res);
      for (const chunk of filteredChunks(buildChatChunks(request, overrides), filter)) {
        sendEvent(res, toInferenceChunk(chunk));
      }
      sendDone(res);
      return;
    }
    res.json(toInferenceCompletion(buildChatCompletion(request, overrides), blocksCompletion(filter)));
  });

  router.post("/embeddings", (req, res) => {
    const body = req.body as EmbeddingRequest;
    assertKnownParameters(req, body, EMBEDDING_PARAMETERS);
    if (body?.input === undefined) throw missing("input");

    const model = modelOf(body);
    const { data, usage } = createEmbeddings({ ...body, model });
    res.json({
      id: deterministicId("", { model, input: body.input }),
      data: data.map(({ embedding, index }) => ({ embedding, index })),
      usage,
      model,
    });
  });

  router.use(notFoundHandler);
  router.use(errorHandler);
  return router;
}
