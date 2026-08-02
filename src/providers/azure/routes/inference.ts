import { Router } from "express";
import { ApiError } from "../../../core/errors";
import { requestOverrides } from "../../../core/override";
import { openSSE, sendDone, sendEvent } from "../../../core/sse";
import { buildChatChunks, buildChatCompletion } from "../../openai/services/chat-completions";
import { createEmbeddings } from "../../openai/services/embeddings";
import type { ChatCompletion, ChatCompletionChunk, EmbeddingRequest } from "../../openai/types";
import type { ChatCompletionRequest } from "../../openai/types";
import {
  blocksCompletion,
  choiceFilterResults,
  contentFilterOverride,
  promptFilterResults,
  type FilterOverride,
} from "../content-filter";
import { AzureContentFilterError } from "../errors";

// The generative endpoints. Azure serves OpenAI's models through its own front
// door, so the payloads are OpenAI's verbatim and these handlers are a thin
// shell over that provider's services — what differs is everything around
// them: the path, the credential, the error envelope, and the content filter
// verdict Azure attaches to every response.
//
// Mounted twice: once behind a deployment on the classic surface, once
// directly under /v1. mergeParams so the deployment stays visible.
export const inferenceRouter = Router({ mergeParams: true });

// Azure reports the filter's verdict on the prompt at the top level and on
// each choice individually.
function withFilterResults(completion: ChatCompletion, override?: FilterOverride) {
  const filtered = blocksCompletion(override);
  return {
    ...completion,
    choices: completion.choices.map((choice) => ({
      ...choice,
      // A filtered generation returns no content and says why.
      ...(filtered ? { message: { ...choice.message, content: null }, finish_reason: "content_filter" } : {}),
      content_filter_results: choiceFilterResults(override),
    })),
    prompt_filter_results: promptFilterResults(override),
  };
}

inferenceRouter.post("/chat/completions", (req, res) => {
  const body = req.body as ChatCompletionRequest;
  if (typeof body?.model !== "string" || !body.model) {
    throw new ApiError(400, "you must provide a model parameter", "BadRequest", "model");
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw new ApiError(400, "'messages' must be a non-empty array.", "BadRequest", "messages");
  }

  const filter = contentFilterOverride(req);
  // A blocked prompt never reaches the model: the call fails outright, and the
  // error carries the verdict that caused it.
  if (filter?.target === "prompt") {
    throw new AzureContentFilterError(promptFilterResults(filter)[0]!.content_filter_results);
  }

  const overrides = requestOverrides(req);
  if (body.stream) {
    openSSE(res);
    // Azure opens a stream with a chunk carrying no choices at all, just the
    // prompt's verdict. Clients that reach straight for choices[0] break on it,
    // which is exactly why it is worth being able to test.
    const chunks = buildChatChunks(body, overrides);
    const first = chunks[0]!;
    sendEvent(res, {
      id: first.id,
      object: first.object,
      created: first.created,
      model: first.model,
      choices: [],
      prompt_filter_results: promptFilterResults(filter),
    });

    for (const chunk of streamed(chunks, filter)) {
      sendEvent(res, chunk);
    }
    // Azure terminates the stream with the same [DONE] sentinel as OpenAI.
    sendDone(res);
    return;
  }
  res.json(withFilterResults(buildChatCompletion(body, overrides), filter));
});

// A filtered generation stops mid-stream: the pieces already produced are kept
// and the last chunk carries the reason.
function streamed(chunks: ChatCompletionChunk[], override?: FilterOverride): ChatCompletionChunk[] {
  if (!blocksCompletion(override)) return chunks;

  const truncated = chunks.slice(0, Math.max(1, Math.ceil(chunks.length / 2)));
  const last = truncated[truncated.length - 1]!;
  return [
    ...truncated.slice(0, -1),
    { ...last, choices: [{ ...last.choices[0]!, finish_reason: "content_filter" }] },
  ];
}

inferenceRouter.post("/embeddings", (req, res) => {
  const body = req.body as EmbeddingRequest;
  if (typeof body?.model !== "string" || !body.model) {
    throw new ApiError(400, "you must provide a model parameter", "BadRequest", "model");
  }
  if (body.input === undefined) {
    throw new ApiError(400, "Missing required parameter: 'input'.", "BadRequest", "input");
  }
  // Embeddings carry no filter verdict: there is no generated content to judge.
  res.json(createEmbeddings(body));
});
