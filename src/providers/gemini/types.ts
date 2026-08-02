// Wire shapes for the Gemini API. Field names are camelCase, resources are
// addressed by a `name` path ("models/gemini-3.6-flash") rather than a bare id,
// and collections come back under a plural key instead of OpenAI's
// `{ object: "list", data: [...] }` envelope.

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

// A turn is a Content, and everything inside it — prose, a tool call, a tool
// result, an image — is a Part. Unlike OpenAI, tool calls are not a field
// alongside the text: they are parts of the same list.
export interface Part {
  text?: string;
  // `args` is a decoded object here, where OpenAI carries a JSON string.
  functionCall?: { name: string; args: unknown };
  functionResponse?: { name: string; response: unknown };
  inlineData?: { mimeType: string; data: string };
  fileData?: { mimeType?: string; fileUri: string };
}

export interface Content {
  role?: string;
  parts?: Part[];
}

export interface GenerationConfig {
  candidateCount?: number;
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  seed?: number;
  stopSequences?: string[];
  responseMimeType?: string;
  responseSchema?: unknown;
}

export interface FunctionCallingConfig {
  mode?: string;
  allowedFunctionNames?: string[];
}

export interface GenerateContentRequest {
  // The REST contract asks for an array; a bare string or a single Content is
  // accepted too because that is what hand-written curl calls tend to send.
  contents?: Content[] | Content | string;
  systemInstruction?: Content | string;
  tools?: unknown;
  toolConfig?: { functionCallingConfig?: FunctionCallingConfig };
  safetySettings?: unknown[];
  generationConfig?: GenerationConfig;
  cachedContent?: string;
}

export interface ModalityTokenCount {
  modality: string;
  tokenCount: number;
}

export interface UsageMetadata {
  promptTokenCount: number;
  candidatesTokenCount: number;
  totalTokenCount: number;
  promptTokensDetails: ModalityTokenCount[];
  candidatesTokensDetails: ModalityTokenCount[];
}

export interface Candidate {
  content: Content;
  finishReason: string;
  index: number;
}

export interface GenerateContentResponse {
  candidates: Candidate[];
  usageMetadata?: UsageMetadata;
  modelVersion: string;
  responseId: string;
}

// ---------------------------------------------------------------------------
// Interactions API
//
// Google's next-generation surface, and a different world from the one above:
// fields are snake_case rather than camelCase, a turn is a Step rather than a
// Content, and text is a typed content item rather than a bare `text` field.

export interface TextContent {
  type: "text";
  text: string;
}

export interface UserInputStep {
  type: "user_input";
  content: TextContent[];
}

export interface ModelOutputStep {
  type: "model_output";
  content: TextContent[];
}

export interface FunctionCallStep {
  type: "function_call";
  id: string;
  name: string;
  // Decoded, like generateContent's `args` and unlike OpenAI's JSON string.
  arguments: unknown;
}

export interface FunctionResultStep {
  type: "function_result";
  call_id: string;
  name?: string;
  result: unknown;
}

export type Step = UserInputStep | ModelOutputStep | FunctionCallStep | FunctionResultStep;

export interface ModalityTokens {
  modality: string;
  tokens: number;
}

// Note the lowercase modality and the absence of an output breakdown: this
// surface reports usage differently from generateContent's usageMetadata, which
// spells modalities in uppercase and details both directions.
export interface InteractionUsage {
  total_tokens: number;
  total_input_tokens: number;
  input_tokens_by_modality: ModalityTokens[];
  total_cached_tokens: number;
  total_output_tokens: number;
  total_tool_use_tokens: number;
  total_thought_tokens: number;
}

export interface CreateInteractionRequest {
  model?: string;
  agent?: unknown;
  input?: string | unknown[];
  stream?: boolean;
  store?: boolean;
  background?: boolean;
  system_instruction?: string;
  tools?: unknown;
  previous_interaction_id?: string;
  // Unlike generateContent, which keeps tool selection in a sibling
  // `toolConfig`, this surface nests it inside the generation config.
  generation_config?: { tool_choice?: unknown; max_output_tokens?: number; seed?: number };
  response_format?: unknown;
}

export type InteractionStatus = "completed" | "cancelled" | "in_progress";

export interface Interaction {
  id: string;
  status: InteractionStatus;
  usage: InteractionUsage;
  created: string;
  updated: string;
  service_tier: string;
  steps: Step[];
  object: "interaction";
  model: string;
}

// Streamed events are discriminated by an `event_type` field inside the data
// payload, not by the SSE `event:` line.
export interface InteractionEvent {
  event_type: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Files API

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
// Embeddings and token counting

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

export interface CountTokensRequest {
  contents?: Content[] | Content | string;
  generateContentRequest?: GenerateContentRequest;
}

export interface CountTokensResponse {
  totalTokens: number;
  promptTokensDetails: ModalityTokenCount[];
}
