// Wire shapes for the Anthropic Messages API. Almost everything on this
// provider is a *content block*: prose, a tool call, a tool result and the
// model's reasoning are all entries in the same list, distinguished by `type`.
// Where OpenAI has `finish_reason` this has `stop_reason`, and the system
// prompt is a top-level field rather than a message.

export interface Model {
  type: "model";
  id: string;
  display_name: string;
  created_at: string;
  max_input_tokens: number;
  max_tokens: number;
  // A nested tree of `{ supported: boolean }` leaves. The SDK reads it with
  // bracket access rather than typed attributes, so it stays loose here too.
  capabilities: Record<string, unknown>;
}

// Models paginate by id cursor, unlike the page/next_page scheme the newer
// Anthropic surfaces use.
export interface ModelList {
  data: Model[];
  has_more: boolean;
  first_id: string | null;
  last_id: string | null;
}

export interface ModelListQuery {
  limit?: string;
  after_id?: string;
  before_id?: string;
}

// ---------------------------------------------------------------------------
// Files (beta)

// A file created inside a session carries the session that made it.
export interface FileScope {
  id: string;
  type: "session";
}

export interface FileMetadata {
  id: string;
  type: "file";
  filename: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  // Only files the API produced itself can be read back. An uploaded one
  // cannot, which the API states here rather than by failing late.
  downloadable: boolean;
  scope?: FileScope | null;
}

export interface FileList {
  data: FileMetadata[];
  has_more: boolean;
  first_id: string | null;
  last_id: string | null;
}

export interface FileListQuery extends ModelListQuery {
  scope_id?: string;
}

export interface FileDeleted {
  id: string;
  type: "file_deleted";
}

// ---------------------------------------------------------------------------
// Messages

export interface TextBlock {
  type: "text";
  text: string;
  // Always present on a response, `null` unless the request enabled citations
  // on a document block. The SDK types it as required.
  citations: null;
}

// The reasoning block. On the current generation the raw chain of thought is
// never returned: `display: "summarized"` yields a summary and the default
// `"omitted"` leaves the text empty — the block itself is emitted either way.
export interface ThinkingBlock {
  type: "thinking";
  thinking: string;
  signature: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  // Decoded, like Gemini's `args` and unlike OpenAI's JSON string.
  input: unknown;
}

export type ContentBlock = TextBlock | ThinkingBlock | ToolUseBlock;

// What a caller may send. `tool_result` travels back inside a `user` message,
// which is how this API says a previous turn already called a tool.
export interface RequestBlock {
  type: string;
  text?: string;
  content?: unknown;
  tool_use_id?: string;
  is_error?: boolean;
  // How a `document` or `image` block points at its bytes: inline base64, a
  // URL, or a file uploaded earlier.
  source?: { type?: string; file_id?: string; url?: string; media_type?: string; data?: string };
}

export interface RequestMessage {
  role: "user" | "assistant" | "system";
  content: string | RequestBlock[];
}

export interface ThinkingConfig {
  type: "adaptive" | "disabled" | "enabled";
  display?: "summarized" | "omitted";
  budget_tokens?: number;
}

export interface MessageRequest {
  model?: string;
  // Required here, unlike on every other provider mocked in this repo.
  max_tokens?: number;
  // A top-level field rather than a message role.
  system?: string | RequestBlock[];
  messages?: RequestMessage[];
  tools?: unknown;
  tool_choice?: { type?: string; name?: string };
  thinking?: ThinkingConfig;
  output_config?: { effort?: string };
  stop_sequences?: string[];
  stream?: boolean;
  metadata?: unknown;
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
}

export type StopReason = "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" | "refusal";

export interface Message {
  id: string;
  type: "message";
  role: "assistant";
  model: string;
  content: ContentBlock[];
  stop_reason: StopReason;
  stop_sequence: string | null;
  usage: Usage;
}
