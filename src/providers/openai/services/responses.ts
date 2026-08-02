import { echoFallback } from "../../../core/fallback";
import { deterministicCreated, deterministicId } from "../../../core/ids";
import type { Overrides } from "../../../core/override";
import { approxTokens } from "../../../core/usage";
import { chunkText } from "../../../core/sse";
import { resolveToolCalls, type ResolvedToolCall } from "../../../core/tools";
import type {
  FunctionCallItem,
  OutputItem,
  OutputMessageItem,
  ResponseObject,
  ResponseRequest,
} from "../types";

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

// A tool result is fed back as a function_call_output item in `input`, which is
// how this API says "a previous turn already called a tool".
function hasFunctionCallOutput(input: unknown): boolean {
  if (!Array.isArray(input)) return false;
  return input.some(
    (item) =>
      typeof item === "object" &&
      item !== null &&
      (item as Record<string, unknown>).type === "function_call_output",
  );
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

function buildFunctionCallItem(call: ResolvedToolCall): FunctionCallItem {
  return {
    id: deterministicId("fc_", { callId: call.id }),
    type: "function_call",
    status: "completed",
    call_id: call.id,
    name: call.name,
    arguments: call.arguments,
  };
}

export function buildResponse(body: ResponseRequest, overrides: Overrides = {}): ResponseObject {
  const inputText = extractInputText(body.input);
  const toolCalls = resolveToolCalls({
    tools: body.tools,
    toolChoice: body.tool_choice,
    override: overrides.toolCalls,
    hasToolResults: hasFunctionCallOutput(body.input),
    seed: { model: body.model, input: body.input },
  });

  // A turn that calls tools carries no prose unless the request pinned some.
  const outputText =
    toolCalls.length > 0 ? (overrides.text ?? null) : (overrides.text ?? echoFallback(inputText));
  const id = deterministicId("resp_", { model: body.model, input: body.input, output: outputText, toolCalls });
  const instructions = typeof body.instructions === "string" ? body.instructions : null;

  return assembleResponse({
    id,
    model: body.model,
    inputText,
    outputText,
    instructions,
    toolCalls,
    tools: Array.isArray(body.tools) ? body.tools : [],
    toolChoice: body.tool_choice ?? "auto",
  });
}

// Stateless stand-in for GET /responses/:id: there is no store to look the
// id up in, so any id yields the same deterministic, well-formed response.
export function buildSyntheticResponse(id: string): ResponseObject {
  return assembleResponse({
    id,
    model: "gpt-4o",
    inputText: undefined,
    outputText: `Echo response ${id}`,
    instructions: null,
    toolCalls: [],
    tools: [],
    toolChoice: "auto",
  });
}

interface AssembleParams {
  id: string;
  model: string;
  inputText: string | undefined;
  outputText: string | null;
  instructions: string | null;
  toolCalls: ResolvedToolCall[];
  tools: unknown[];
  toolChoice: unknown;
}

function assembleResponse(params: AssembleParams): ResponseObject {
  const { id, model, inputText, outputText, instructions, toolCalls, tools, toolChoice } = params;
  const inputTokens = approxTokens(inputText ?? "");
  const outputTokens = approxTokens(
    (outputText ?? "") + toolCalls.map((call) => call.name + call.arguments).join(""),
  );
  const output: OutputItem[] = [
    ...(outputText === null ? [] : [buildOutputItem(id, outputText)]),
    ...toolCalls.map(buildFunctionCallItem),
  ];

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
    output,
    parallel_tool_calls: true,
    previous_response_id: null,
    reasoning: { effort: null, summary: null },
    store: true,
    temperature: 1,
    text: { format: { type: "text" } },
    tool_choice: toolChoice,
    tools,
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
// created → in_progress → per output item → completed. A message item streams
// content parts; a function_call item streams its arguments instead.
export function buildResponseEvents(response: ResponseObject): StreamEvent[] {
  const inProgress: ResponseObject = { ...response, status: "in_progress", output: [] };
  const counter = { seq: 0 };

  const events: StreamEvent[] = [
    { type: "response.created", response: inProgress, sequence_number: counter.seq++ },
    { type: "response.in_progress", response: inProgress, sequence_number: counter.seq++ },
  ];

  response.output.forEach((item, outputIndex) => {
    events.push(
      ...(item.type === "message"
        ? messageEvents(item, outputIndex, counter)
        : functionCallEvents(item, outputIndex, counter)),
    );
  });

  events.push({ type: "response.completed", response, sequence_number: counter.seq++ });
  return events;
}

function messageEvents(item: OutputMessageItem, outputIndex: number, counter: { seq: number }): StreamEvent[] {
  const part = item.content[0]!;
  const events: StreamEvent[] = [
    {
      type: "response.output_item.added",
      output_index: outputIndex,
      item: { ...item, status: "in_progress", content: [] },
      sequence_number: counter.seq++,
    },
    {
      type: "response.content_part.added",
      item_id: item.id,
      output_index: outputIndex,
      content_index: 0,
      part: { type: "output_text", text: "", annotations: [] },
      sequence_number: counter.seq++,
    },
  ];

  for (const piece of chunkText(part.text)) {
    events.push({
      type: "response.output_text.delta",
      item_id: item.id,
      output_index: outputIndex,
      content_index: 0,
      delta: piece,
      logprobs: [],
      sequence_number: counter.seq++,
    });
  }

  events.push(
    {
      type: "response.output_text.done",
      item_id: item.id,
      output_index: outputIndex,
      content_index: 0,
      text: part.text,
      logprobs: [],
      sequence_number: counter.seq++,
    },
    {
      type: "response.content_part.done",
      item_id: item.id,
      output_index: outputIndex,
      content_index: 0,
      part,
      sequence_number: counter.seq++,
    },
    { type: "response.output_item.done", output_index: outputIndex, item, sequence_number: counter.seq++ },
  );
  return events;
}

function functionCallEvents(item: FunctionCallItem, outputIndex: number, counter: { seq: number }): StreamEvent[] {
  const events: StreamEvent[] = [
    {
      type: "response.output_item.added",
      output_index: outputIndex,
      item: { ...item, status: "in_progress", arguments: "" },
      sequence_number: counter.seq++,
    },
  ];

  for (const piece of chunkText(item.arguments)) {
    events.push({
      type: "response.function_call_arguments.delta",
      item_id: item.id,
      output_index: outputIndex,
      delta: piece,
      sequence_number: counter.seq++,
    });
  }

  events.push(
    {
      type: "response.function_call_arguments.done",
      item_id: item.id,
      output_index: outputIndex,
      arguments: item.arguments,
      sequence_number: counter.seq++,
    },
    { type: "response.output_item.done", output_index: outputIndex, item, sequence_number: counter.seq++ },
  );
  return events;
}
