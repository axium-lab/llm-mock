// Wire shapes specific to Gemini Enterprise, the platform formerly called
// Vertex AI. The generative contract it shares with AI Studio lives in
// ../google-shared/types; what differs is gathered here.

// A publisher model is addressed as publishers/google/models/{id}, and carries
// fewer fields than AI Studio's catalog: no token limits, and the version is
// `versionId` rather than `version`.
export interface PublisherModel {
  name: string;
  versionId: string;
  displayName: string;
  description: string;
  launchStage: string;
}

export interface ListPublisherModelsResponse {
  publisherModels: PublisherModel[];
  nextPageToken?: string;
}

// Where a request landed. Regional callers carry a project and a location in
// the path; express-mode callers, authenticating with an API key, do not.
export interface CallerScope {
  project?: string;
  location?: string;
}

// ---------------------------------------------------------------------------
// :predict — the generic prediction endpoint this platform embeds through.

export interface PredictRequest {
  instances?: unknown[];
  parameters?: { outputDimensionality?: unknown; autoTruncate?: boolean };
}

export interface Prediction {
  embeddings: {
    values: number[];
    // snake_case inside an otherwise camelCase API, as the platform reports it.
    statistics: { truncated: boolean; token_count: number };
  };
}

export interface PredictResponse {
  predictions: Prediction[];
}

// countTokens reports only the total here; AI Studio's equivalent also breaks
// the count down by modality, and the SDK's Vertex transformer reads no such
// field.
export interface VertexCountTokensResponse {
  totalTokens: number;
}
