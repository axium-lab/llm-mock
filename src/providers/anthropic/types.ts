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
