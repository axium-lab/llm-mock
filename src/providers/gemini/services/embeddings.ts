import { deterministicVector } from "../../../core/embeddings";
import { ApiError } from "../../../core/errors";
import { normalizeContents } from "../../google-shared/generate-content";
import type { Content } from "../../google-shared/types";
import type { ContentEmbedding, EmbedContentRequest } from "../types";

// gemini-embedding-001 emits 3072 dimensions and supports Matryoshka
// truncation down to 1536 or 768 via outputDimensionality; the older models
// only ever emit 768.
const MODEL_DIMENSIONS: Record<string, number> = {
  "gemini-embedding-001": 3072,
  "gemini-embedding-2-preview": 3072,
  "text-embedding-004": 768,
  "embedding-001": 768,
};

const DEFAULT_DIMENSIONS = 3072;
const MAX_DIMENSIONS = 3072;

// Exposed for the OpenAI-compatibility layer, which serves these same models
// through OpenAI's embeddings service and must not fall back to its 1536.
export function nativeDimensions(model: string): number | undefined {
  return MODEL_DIMENSIONS[model];
}

function contentText(content: Content | undefined): string {
  return (content?.parts ?? []).map((part) => part.text ?? "").join("");
}

function dimensionsFor(model: string, requested: unknown): number {
  if (requested === undefined || requested === null) return MODEL_DIMENSIONS[model] ?? DEFAULT_DIMENSIONS;
  if (typeof requested !== "number" || !Number.isInteger(requested) || requested < 1 || requested > MAX_DIMENSIONS) {
    throw new ApiError(
      400,
      `outputDimensionality must be an integer between 1 and ${MAX_DIMENSIONS}.`,
      "INVALID_ARGUMENT",
    );
  }
  return requested;
}

function embed(model: string, content: Content | undefined, outputDimensionality: unknown): ContentEmbedding {
  const text = contentText(content);
  return { values: deterministicVector(`${model}:${text}`, dimensionsFor(model, outputDimensionality)) };
}

// The `content` field is a single Content, but hand-written callers often send
// a bare string or an array, so the same normalizer the generative endpoints
// use is applied here too.
function asContent(raw: unknown): Content | undefined {
  return normalizeContents(raw as Content[] | Content | string)[0];
}

export function embedContent(model: string, body: EmbedContentRequest) {
  if (body?.content === undefined) {
    throw new ApiError(400, "* EmbedContentRequest.content: content is not specified\n", "INVALID_ARGUMENT");
  }
  return { embedding: embed(model, asContent(body.content), body.outputDimensionality) };
}

// Every request in the batch names its own model, but the one in the URL is
// what the real API dispatches on, so that is the one used here.
export function batchEmbedContents(model: string, body: { requests?: EmbedContentRequest[] }) {
  const requests = body?.requests;
  if (!Array.isArray(requests)) {
    throw new ApiError(400, "* BatchEmbedContentsRequest.requests: requests is not specified\n", "INVALID_ARGUMENT");
  }
  return {
    embeddings: requests.map((request) =>
      embed(model, asContent(request?.content), request?.outputDimensionality),
    ),
  };
}
