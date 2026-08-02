import { deterministicVector } from "../../../core/embeddings";
import { ApiError } from "../../../core/errors";
import { approxTokens } from "../../../core/usage";
import type { EmbeddingObject, EmbeddingRequest } from "../types";

const MODEL_DIMENSIONS: Record<string, number> = {
  "text-embedding-3-small": 1536,
  "text-embedding-3-large": 3072,
  "text-embedding-ada-002": 1536,
};

const DEFAULT_DIMENSIONS = 1536;

// The official SDK requests base64 by default and decodes it client-side.
function encodeBase64(vector: number[]): string {
  return Buffer.from(new Float32Array(vector).buffer).toString("base64");
}

function normalizeInputs(input: EmbeddingRequest["input"]): string[] {
  if (typeof input === "string") return [input];
  if (Array.isArray(input)) {
    if (input.length === 0) {
      throw new ApiError(400, "'input' must not be empty.", null, "input");
    }
    // A flat array of numbers is a single tokenized input.
    if (input.every((item) => typeof item === "number")) return [input.join(" ")];
    return input.map((item) => (typeof item === "string" ? item : JSON.stringify(item)));
  }
  throw new ApiError(400, "'input' must be a string, an array of strings, or an array of tokens.", null, "input");
}

export function createEmbeddings(body: EmbeddingRequest) {
  const inputs = normalizeInputs(body.input);
  const dimensions = body.dimensions ?? MODEL_DIMENSIONS[body.model] ?? DEFAULT_DIMENSIONS;
  if (!Number.isInteger(dimensions) || dimensions < 1) {
    throw new ApiError(400, "'dimensions' must be a positive integer.", null, "dimensions");
  }

  const data: EmbeddingObject[] = inputs.map((text, index) => {
    const vector = deterministicVector(`${body.model}:${text}`, dimensions);
    return {
      object: "embedding",
      index,
      embedding: body.encoding_format === "base64" ? encodeBase64(vector) : vector,
    };
  });

  const promptTokens = inputs.reduce((sum, text) => sum + approxTokens(text), 0);
  return {
    object: "list" as const,
    data,
    model: body.model,
    usage: { prompt_tokens: promptTokens, total_tokens: promptTokens },
  };
}
