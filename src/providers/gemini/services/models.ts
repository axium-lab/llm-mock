import { ApiError } from "../../../core/errors";
import type { GeminiModel, ListModelsResponse } from "../types";

const GENERATIVE_METHODS = ["generateContent", "countTokens", "createCachedContent", "batchGenerateContent"];
const EMBEDDING_METHODS = ["embedContent", "batchEmbedContents", "countTokens"];

// Simulated catalog mirroring the ids AI Studio serves today, checked against
// the live /v1beta/models listing. Values are fixed so the listing is
// byte-identical on every call.
const CATALOG: GeminiModel[] = [
  {
    name: "models/gemini-3.1-pro-preview",
    version: "3.1",
    displayName: "Gemini 3.1 Pro Preview",
    description: "Most intelligent Gemini model.",
    inputTokenLimit: 1_048_576,
    outputTokenLimit: 65_536,
    supportedGenerationMethods: GENERATIVE_METHODS,
    temperature: 1,
    maxTemperature: 2,
    topP: 0.95,
    topK: 64,
    thinking: true,
  },
  {
    name: "models/gemini-3.6-flash",
    version: "3.6",
    displayName: "Gemini 3.6 Flash",
    description: "Frontier-class model balancing capability and cost.",
    inputTokenLimit: 1_048_576,
    outputTokenLimit: 65_536,
    supportedGenerationMethods: GENERATIVE_METHODS,
    temperature: 1,
    maxTemperature: 2,
    topP: 0.95,
    topK: 64,
    thinking: true,
  },
  {
    name: "models/gemini-3-flash-preview",
    version: "3.0",
    displayName: "Gemini 3 Flash Preview",
    description: "Fast general-purpose model.",
    inputTokenLimit: 1_048_576,
    outputTokenLimit: 65_536,
    supportedGenerationMethods: GENERATIVE_METHODS,
    temperature: 1,
    maxTemperature: 2,
    topP: 0.95,
    topK: 64,
  },
  {
    name: "models/gemini-3.5-flash-lite",
    version: "3.5",
    displayName: "Gemini 3.5 Flash-Lite",
    description: "Low-latency, high-throughput model.",
    inputTokenLimit: 1_048_576,
    outputTokenLimit: 65_536,
    supportedGenerationMethods: GENERATIVE_METHODS,
    temperature: 1,
    maxTemperature: 2,
    topP: 0.95,
    topK: 64,
  },
  {
    name: "models/gemini-embedding-001",
    version: "001",
    displayName: "Gemini Embedding 001",
    description: "Text embedding model.",
    inputTokenLimit: 2048,
    outputTokenLimit: 1,
    supportedGenerationMethods: EMBEDDING_METHODS,
  },
];

export function listModels(): ListModelsResponse {
  return { models: CATALOG };
}

// Callers address a model either bare ("gemini-3.6-flash") or by resource name
// ("models/gemini-3.6-flash"); both reach the same entry.
export function getModel(id: string): GeminiModel | undefined {
  const name = id.startsWith("models/") ? id : `models/${id}`;
  return CATALOG.find((model) => model.name === name);
}

// The real API reports an unknown model and an unsupported method through the
// same 404, naming the method that was attempted.
export function modelNotFound(id: string, method: string): ApiError {
  const name = id.startsWith("models/") ? id : `models/${id}`;
  return new ApiError(
    404,
    `${name} is not found for API version v1beta, or is not supported for ${method}. ` +
      "Call ListModels to see the list of available models and their supported methods.",
    "MODEL_NOT_FOUND",
  );
}
