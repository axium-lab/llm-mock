import { echoFallback } from "../../../core/fallback";
import { deterministicCreated, deterministicId } from "../../../core/ids";
import { approxTokens } from "../../../core/usage";
import { chunkText } from "../../../core/sse";
import type { OutputMessageItem, ResponseObject, ResponseRequest } from "../types";

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

export function buildResponse(body: ResponseRequest, override?: string): ResponseObject {
  const inputText = extractInputText(body.input);
  const outputText = override ?? echoFallback(inputText);
  const id = deterministicId("resp_", { model: body.model, input: body.input, output: outputText });
  const instructions = typeof body.instructions === "string" ? body.instructions : null;
  return assembleResponse(id, body.model, inputText, outputText, instructions);
}

// Stateless stand-in for GET /responses/:id: there is no store to look the
// id up in, so any id yields the same deterministic, well-formed response.
export function buildSyntheticResponse(id: string): ResponseObject {
  return assembleResponse(id, "gpt-4o", undefined, `Echo response ${id}`, null);
}

function assembleResponse(
  id: string,
  model: string,
  inputText: string | undefined,
  outputText: string,
  instructions: string | null,
): ResponseObject {
  const inputTokens = approxTokens(inputText ?? "");
  const outputTokens = approxTokens(outputText);

  return {
    id,
    object: "response",
    created_at: deterministicCreated(id),
    status: "completed",
    background: false,
    error: null,
    incomplete_details: null,
    instructions,
    max_output_tokens: null,
    model,
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
