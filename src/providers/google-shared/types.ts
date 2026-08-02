// Wire shapes common to Google's two Gemini surfaces — AI Studio
// (generativelanguage.googleapis.com) and Gemini Enterprise, the platform
// formerly called Vertex AI. Both speak the same generative contract: field
// names are camelCase, a turn is a Content and a tool call is a Part of it.
//
// What is NOT here is anything a single surface owns: model catalogs, the
// Files API, AI Studio's :embedContent, Gemini Enterprise's :predict. Those
// live with their provider.

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

export interface CountTokensRequest {
  contents?: Content[] | Content | string;
  generateContentRequest?: GenerateContentRequest;
}

export interface CountTokensResponse {
  totalTokens: number;
  promptTokensDetails: ModalityTokenCount[];
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
