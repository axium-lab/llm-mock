import { deterministicVector } from "../../../core/embeddings";
import { ApiError } from "../../../core/errors";
import { approxTokens } from "../../../core/usage";
import type { PredictRequest, PredictResponse, Prediction } from "../types";

// Embedding models this platform serves. gemini-embedding-001 emits 3072
// dimensions with Matryoshka truncation; the text-embedding family emits 768.
const MODEL_DIMENSIONS: Record<string, number> = {
  "gemini-embedding-001": 3072,
  "text-embedding-005": 768,
  "text-embedding-004": 768,
  "text-multilingual-embedding-002": 768,
};

const DEFAULT_DIMENSIONS = 768;
const MAX_DIMENSIONS = 3072;

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

function instanceText(instance: unknown): string {
  if (typeof instance === "string") return instance;
  if (instance && typeof instance === "object") {
    const content = (instance as { content?: unknown }).content;
    if (typeof content === "string") return content;
  }
  return "";
}

// Embeddings do not have their own method on this platform: they go through
// the generic :predict endpoint, wrapped in an instances/predictions envelope
// that looks nothing like AI Studio's :embedContent. Note the snake_case
// `token_count` sitting inside an otherwise camelCase API.
export function predictEmbeddings(model: string, body: PredictRequest): PredictResponse {
  const instances = body?.instances;
  if (!Array.isArray(instances) || instances.length === 0) {
    throw new ApiError(400, "Invalid request: instances is not specified.", "INVALID_ARGUMENT");
  }

  // Unlike the per-instance task_type and title, the dimension count is set
  // once for the whole call in a sibling `parameters` object.
  const dimensions = dimensionsFor(model, body.parameters?.outputDimensionality);

  const predictions: Prediction[] = instances.map((instance) => {
    const text = instanceText(instance);
    return {
      embeddings: {
        values: deterministicVector(`${model}:${text}`, dimensions),
        statistics: { truncated: false, token_count: approxTokens(text) },
      },
    };
  });

  return { predictions };
}
