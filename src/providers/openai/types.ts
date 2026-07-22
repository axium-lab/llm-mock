// Minimal subset of the OpenAI contract used by the mock. The definitive
// contract validation lives in the integration tests, which use the official
// `openai` SDK as the client.

export type Role = "system" | "developer" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: Role;
  content: string | Array<{ type: string; text?: string }> | null;
  [key: string]: unknown;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  n?: number;
  stream?: boolean;
  stream_options?: { include_usage?: boolean };
  [key: string]: unknown;
}

export interface CompletionUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatCompletionChoice {
  index: number;
  message: { role: "assistant"; content: string; refusal: null; annotations: [] };
  logprobs: null;
  finish_reason: "stop";
}

export interface ChatCompletion {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage: CompletionUsage;
  system_fingerprint: string;
}

export interface ChatCompletionChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  system_fingerprint: string;
  choices: Array<{
    index: number;
    delta: { role?: "assistant"; content?: string };
    logprobs: null;
    finish_reason: "stop" | null;
  }>;
  usage?: CompletionUsage;
}

export interface Model {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
}

export interface EmbeddingRequest {
  model: string;
  input: string | string[] | number[] | number[][];
  dimensions?: number;
  encoding_format?: "float" | "base64";
  [key: string]: unknown;
}

export interface EmbeddingObject {
  object: "embedding";
  index: number;
  embedding: number[] | string;
}

export interface ResponseUsage {
  input_tokens: number;
  input_tokens_details: { cached_tokens: number };
  output_tokens: number;
  output_tokens_details: { reasoning_tokens: number };
  total_tokens: number;
}

export interface OutputTextPart {
  type: "output_text";
  text: string;
  annotations: [];
}

export interface OutputMessageItem {
  id: string;
  type: "message";
  status: "completed";
  role: "assistant";
  content: OutputTextPart[];
}

export interface ResponseRequest {
  model: string;
  input: unknown;
  instructions?: string | null;
  stream?: boolean;
  [key: string]: unknown;
}

export interface ResponseObject {
  id: string;
  object: "response";
  created_at: number;
  status: "completed" | "in_progress";
  background: boolean;
  error: null;
  incomplete_details: null;
  instructions: string | null;
  max_output_tokens: null;
  model: string;
  output: OutputMessageItem[];
  parallel_tool_calls: boolean;
  previous_response_id: null;
  reasoning: { effort: null; summary: null };
  store: boolean;
  temperature: number;
  text: { format: { type: "text" } };
  tool_choice: "auto";
  tools: [];
  top_p: number;
  truncation: "disabled";
  usage: ResponseUsage;
  user: null;
  metadata: Record<string, never>;
}
