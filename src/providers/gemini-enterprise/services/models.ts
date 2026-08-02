import { ApiError } from "../../../core/errors";
import type { ListPublisherModelsResponse, PublisherModel } from "../types";

const PREFIX = "publishers/google/models/";

// Simulated catalog. Gemini Enterprise serves the same model family as AI
// Studio but describes it with fewer fields — the SDK reads only name,
// versionId, displayName and description here, and no token limits are
// reported at all.
const CATALOG: PublisherModel[] = [
  entry("gemini-3.1-pro-preview", "3.1", "Gemini 3.1 Pro Preview", "Most intelligent Gemini model.", "PUBLIC_PREVIEW"),
  entry("gemini-3.6-flash", "3.6", "Gemini 3.6 Flash", "Frontier-class model balancing capability and cost.", "GA"),
  entry("gemini-3-flash-preview", "3.0", "Gemini 3 Flash Preview", "Fast general-purpose model.", "PUBLIC_PREVIEW"),
  entry("gemini-3.5-flash-lite", "3.5", "Gemini 3.5 Flash-Lite", "Low-latency, high-throughput model.", "GA"),
  entry("text-embedding-005", "005", "Text Embedding 005", "Text embedding model.", "GA"),
  entry("gemini-embedding-001", "001", "Gemini Embedding 001", "Text embedding model.", "GA"),
];

function entry(
  id: string,
  versionId: string,
  displayName: string,
  description: string,
  launchStage: string,
): PublisherModel {
  return { name: `${PREFIX}${id}`, versionId, displayName, description, launchStage };
}

export function listPublisherModels(): ListPublisherModelsResponse {
  return { publisherModels: CATALOG };
}

// Callers address a model bare ("gemini-3.6-flash") or by resource name; both
// reach the same entry.
export function getPublisherModel(id: string): PublisherModel | undefined {
  const name = id.startsWith(PREFIX) ? id : `${PREFIX}${id}`;
  return CATALOG.find((model) => model.name === name);
}

// The real platform reports an unknown model and an unsupported method through
// the same 404, naming the method that was attempted.
export function modelNotFound(id: string, method: string): ApiError {
  const bare = id.startsWith(PREFIX) ? id.slice(PREFIX.length) : id;
  return new ApiError(
    404,
    `Publisher Model \`${PREFIX}${bare}\` was not found or your project does not have access to it. ` +
      `Please ensure you are using a valid model version and that ${method} is supported for it.`,
    "NOT_FOUND",
  );
}
