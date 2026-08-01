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
  tools?: unknown;
  tool_choice?: unknown;
  [key: string]: unknown;
}

export interface ToolCall {
  id: string;
  type: "function";
  // `arguments` is a JSON-encoded string on the wire, not an object.
  function: { name: string; arguments: string };
}

// Streaming counterpart: the pieces are keyed by `index` so the client can
// reassemble one call from many chunks.
export interface ToolCallDelta {
  index: number;
  id?: string;
  type?: "function";
  function?: { name?: string; arguments?: string };
}

export interface CompletionUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatCompletionChoice {
  index: number;
  message: {
    role: "assistant";
    // null whenever the model answers with tool calls instead of prose.
    content: string | null;
    refusal: null;
    annotations: [];
    tool_calls?: ToolCall[];
  };
  logprobs: null;
  finish_reason: "stop" | "tool_calls";
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
    delta: { role?: "assistant"; content?: string | null; tool_calls?: ToolCallDelta[] };
    logprobs: null;
    finish_reason: "stop" | "tool_calls" | null;
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

// Purposes a client is allowed to upload with. The read-only ones the real API
// also exposes (assistants_output, batch_output, fine-tune-results) are
// server-generated and therefore rejected on upload.
export type FilePurpose = "assistants" | "batch" | "fine-tune" | "vision" | "user_data" | "evals";

export interface FileObject {
  id: string;
  object: "file";
  bytes: number;
  created_at: number;
  expires_at?: number;
  filename: string;
  purpose: string;
  // Deprecated upstream but still present on the wire, and the SDK types it as
  // required, so the mock keeps emitting it.
  status: "uploaded" | "processed" | "error";
}

export interface FileList {
  object: "list";
  data: FileObject[];
  has_more: boolean;
  first_id: string | null;
  last_id: string | null;
}

export interface FileDeleted {
  id: string;
  object: "file";
  deleted: true;
}

export interface FileListQuery {
  purpose?: string;
  limit?: string;
  order?: string;
  after?: string;
}

export interface Upload {
  id: string;
  object: "upload";
  bytes: number;
  created_at: number;
  expires_at: number;
  filename: string;
  purpose: string;
  status: "pending" | "completed" | "cancelled" | "expired";
  file: FileObject | null;
}

export interface UploadPart {
  id: string;
  object: "upload.part";
  created_at: number;
  upload_id: string;
}

export interface CreateUploadRequest {
  filename?: unknown;
  bytes?: unknown;
  mime_type?: unknown;
  purpose?: unknown;
  [key: string]: unknown;
}

export interface CompleteUploadRequest {
  part_ids?: unknown;
  md5?: unknown;
  [key: string]: unknown;
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

// The Responses API models a tool call as a top-level output item rather than
// a field on the assistant message. `call_id` is what the client echoes back
// in the matching function_call_output item.
export interface FunctionCallItem {
  id: string;
  type: "function_call";
  status: "completed";
  call_id: string;
  name: string;
  arguments: string;
}

export type OutputItem = OutputMessageItem | FunctionCallItem;

export interface ResponseRequest {
  model: string;
  input: unknown;
  instructions?: string | null;
  stream?: boolean;
  tools?: unknown;
  tool_choice?: unknown;
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
  output: OutputItem[];
  parallel_tool_calls: boolean;
  previous_response_id: null;
  reasoning: { effort: null; summary: null };
  store: boolean;
  temperature: number;
  text: { format: { type: "text" } };
  // Echoed back from the request, as the real API does.
  tool_choice: unknown;
  tools: unknown[];
  top_p: number;
  truncation: "disabled";
  usage: ResponseUsage;
  user: null;
  metadata: Record<string, never>;
}
