// Wire shapes specific to the Gemini API as AI Studio serves it. What this
// surface shares with Gemini Enterprise — the Content/Part model,
// generateContent, countTokens and the Interactions API — lives in
// ../google-shared/types.
//
// Resources here are addressed by a `name` path ("models/gemini-3.6-flash")
// rather than a bare id, and collections come back under a plural key instead
// of OpenAI's `{ object: "list", data: [...] }` envelope.

import type { Content } from "../google-shared/types";

export interface GeminiModel {
  name: string;
  version: string;
  displayName: string;
  description: string;
  inputTokenLimit: number;
  outputTokenLimit: number;
  // The SDK exposes this as `supportedActions`, but the wire name is this one.
  supportedGenerationMethods: string[];
  temperature?: number;
  maxTemperature?: number;
  topP?: number;
  topK?: number;
  thinking?: boolean;
}

export interface ListModelsResponse {
  models: GeminiModel[];
  nextPageToken?: string;
}

export interface ListTunedModelsResponse {
  tunedModels: GeminiModel[];
  nextPageToken?: string;
}

// ---------------------------------------------------------------------------
// Files API — AI Studio only. Gemini Enterprise has no equivalent: its clients
// share files through a GCS bucket, and the SDK refuses an upload outright.

export interface GeminiFile {
  name: string;
  displayName: string;
  mimeType: string;
  // A string on the wire, not a number, as with every int64 in a Google API.
  sizeBytes: string;
  createTime: string;
  updateTime: string;
  expirationTime: string;
  sha256Hash: string;
  uri: string;
  state: "PROCESSING" | "ACTIVE" | "FAILED";
}

export interface ListFilesResponse {
  files: GeminiFile[];
  nextPageToken?: string;
}

// Metadata the client declares when it opens a resumable upload.
export interface UploadStartMetadata {
  displayName?: string;
  mimeType?: string;
  sizeBytes?: string | number;
}

// ---------------------------------------------------------------------------
// Embeddings — also AI Studio's own shape. Gemini Enterprise embeds through
// :predict, with an instances/predictions envelope instead.

export interface ContentEmbedding {
  values: number[];
}

export interface EmbedContentRequest {
  content?: Content | Content[] | string;
  taskType?: string;
  title?: string;
  outputDimensionality?: unknown;
  model?: string;
}
