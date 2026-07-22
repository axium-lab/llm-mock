import { deterministicId } from "../core/ids";
import { approxTokens } from "../core/usage";
import { chunkText } from "../core/streaming";
import { resolveContent } from "./chat-completions";
import type { OutputMessageItem, ResponseObject, ResponseRequest } from "../types/openai";

// In-memory persistence for GET/DELETE by id. Restarting the server clears it.
const store = new Map<string, ResponseObject>();

// `input` accepts a plain string or an array of message-like items whose
// content is a string or a list of input_text parts.
export function extractInputText(input: unknown): string | undefined {
  if (typeof input === "string") return input || undefined;
  if (!Array.isArray(input)) return undefined;

  const userItems = input.filter(
    (item): item is Record<string, unknown> =>
      typeof item === "object" && item !== null && (item as Record<string, unknown>).role === "user",
  );
  const last = userItems[userItems.length - 1];
  if (!last) return undefined;

  const content = last.content;
  if (typeof content === "string") return content || undefined;
  if (Array.isArray(content)) {
    const text = content
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("");
    return text || undefined;
  }
  return undefined;
}

function buildOutputItem(responseId: string, text: string): OutputMessageItem {
  return {
    id: deterministicId("msg_", { responseId }),
    type: "message",
    status: "completed",
    role: "assistant",
    content: [{ type: "output_text", text, annotations: [] }],
  };
}

export function buildResponse(body: ResponseRequest): ResponseObject {
  const inputText = extractInputText(body.input);
  const outputText = resolveContent(body.model, inputText);
  const id = deterministicId("resp_", { model: body.model, input: body.input });

  const inputTokens = approxTokens(inputText ?? "");
  const outputTokens = approxTokens(outputText);

  return {
    id,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status: "completed",
    background: false,
    error: null,
    incomplete_details: null,
    instructions: typeof body.instructions === "string" ? body.instructions : null,
    max_output_tokens: null,
    model: body.model,
    output: [buildOutputItem(id, outputText)],
    parallel_tool_calls: true,
    previous_response_id: null,
    reasoning: { effort: null, summary: null },
    store: true,
    temperature: 1,
    text: { format: { type: "text" } },
    tool_choice: "auto",
    tools: [],
    top_p: 1,
    truncation: "disabled",
    usage: {
      input_tokens: inputTokens,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: outputTokens,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: inputTokens + outputTokens,
    },
    user: null,
    metadata: {},
  };
}

export function saveResponse(response: ResponseObject): void {
  store.set(response.id, response);
}

export function getResponse(id: string): ResponseObject | undefined {
  return store.get(id);
}

export function deleteResponse(id: string): boolean {
  return store.delete(id);
}

interface StreamEvent {
  type: string;
  [key: string]: unknown;
}

// Typed SSE event sequence for `stream: true`, mirroring the real API:
// created → in_progress → output_item.added → content_part.added →
// output_text.delta* → output_text.done → content_part.done →
// output_item.done → completed.
export function buildResponseEvents(response: ResponseObject): StreamEvent[] {
  const item = response.output[0]!;
  const part = item.content[0]!;
  const inProgress: ResponseObject = { ...response, status: "in_progress", output: [] };
  let seq = 0;

  const events: StreamEvent[] = [
    { type: "response.created", response: inProgress, sequence_number: seq++ },
    { type: "response.in_progress", response: inProgress, sequence_number: seq++ },
    {
      type: "response.output_item.added",
      output_index: 0,
      item: { ...item, status: "in_progress", content: [] },
      sequence_number: seq++,
    },
    {
      type: "response.content_part.added",
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      part: { type: "output_text", text: "", annotations: [] },
      sequence_number: seq++,
    },
  ];

  for (const piece of chunkText(part.text)) {
    events.push({
      type: "response.output_text.delta",
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      delta: piece,
      logprobs: [],
      sequence_number: seq++,
    });
  }

  events.push(
    {
      type: "response.output_text.done",
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      text: part.text,
      logprobs: [],
      sequence_number: seq++,
    },
    {
      type: "response.content_part.done",
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      part,
      sequence_number: seq++,
    },
    { type: "response.output_item.done", output_index: 0, item, sequence_number: seq++ },
    { type: "response.completed", response, sequence_number: seq++ },
  );
  return events;
}
