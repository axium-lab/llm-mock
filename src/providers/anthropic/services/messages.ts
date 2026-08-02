import { echoFallback } from "../../../core/fallback";
import { deterministicId } from "../../../core/ids";
import type { Overrides } from "../../../core/override";
import { resolveToolCalls, type ResolvedToolCall } from "../../../core/tools";
import { approxTokens } from "../../../core/usage";
import type {
  ContentBlock,
  Message,
  MessageRequest,
  RequestBlock,
  RequestMessage,
  ThinkingBlock,
  ToolUseBlock,
  Usage,
} from "../types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// A message's content is a bare string or a list of typed blocks. Only the
// prose is of interest here; images and documents contribute nothing to an
// echo.
function blockText(content: string | RequestBlock[] | undefined): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((block) => (block?.type === "text" ? (block.text ?? "") : "")).join("");
}

// Attaching a file to a turn with no prose is a real shape — upload a PDF and
// let the question be implicit. Naming the attachment keeps the echo useful:
// without it, that turn would fall through to the generic greeting and a test
// could not tell whether the reference even arrived.
function attachmentText(content: string | RequestBlock[] | undefined): string {
  if (!Array.isArray(content)) return "";
  const files = content
    .filter((block) => block?.type === "document" || block?.type === "image")
    .map((block) => block.source?.file_id)
    .filter((fileId): fileId is string => typeof fileId === "string" && fileId.length > 0);
  return files.length === 0 ? "" : `[${files.join(", ")}]`;
}

export function lastUserText(messages: RequestMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role !== "user") continue;
    const text = blockText(message.content) || attachmentText(message.content);
    if (text) return text;
  }
  return undefined;
}

// A tool result comes back as a `tool_result` block inside a user message, so
// its presence means a previous turn already called a tool.
function hasToolResults(messages: RequestMessage[]): boolean {
  return messages.some(
    (message) => Array.isArray(message.content) && message.content.some((block) => block?.type === "tool_result"),
  );
}

// tool_choice is an object rather than a keyword: {type: "any"} forces a call,
// {type: "tool", name} names one, {type: "none"} forbids them.
function toToolChoice(raw: MessageRequest["tool_choice"]): unknown {
  if (!isRecord(raw)) return "auto";
  switch (raw.type) {
    case "any":
      return "required";
    case "none":
      return "none";
    case "tool":
      return typeof raw.name === "string" ? { name: raw.name } : "required";
    default:
      return "auto";
  }
}

// The wire carries `input` as a decoded object. A pinned override may hold a
// string that is deliberately not valid JSON, so a client can exercise its own
// parsing failure; that string is passed through untouched.
function toInput(call: ResolvedToolCall): unknown {
  try {
    return JSON.parse(call.arguments);
  } catch {
    return call.arguments;
  }
}

function systemText(system: MessageRequest["system"]): string {
  return blockText(system);
}

function usageFor(messages: RequestMessage[], system: string, output: string): Usage {
  const input =
    messages.reduce((sum, message) => sum + approxTokens(blockText(message.content)), 0) +
    (system ? approxTokens(system) : 0);
  return { input_tokens: input, output_tokens: approxTokens(output) };
}

// Thinking is requested, never volunteered. The block is emitted whenever
// thinking is on; what `display` controls is only whether its text is filled
// in — "omitted" is the default on the current generation and leaves it empty.
function thinkingBlock(request: MessageRequest, id: string, prompt: string | undefined): ThinkingBlock[] {
  const config = request.thinking;
  if (!config || config.type === "disabled") return [];

  const summarized = config.display === "summarized";
  return [
    {
      type: "thinking",
      thinking: summarized ? `Considering how to answer: ${prompt ?? "the request"}.` : "",
      signature: deterministicId("", { id, prompt }).slice(0, 32),
    },
  ];
}

export function buildMessage(request: MessageRequest, overrides: Overrides = {}): Message {
  const messages = request.messages ?? [];
  const model = request.model ?? "";
  const prompt = lastUserText(messages);

  const toolCalls = resolveToolCalls({
    tools: request.tools,
    toolChoice: toToolChoice(request.tool_choice),
    override: overrides.toolCalls,
    hasToolResults: hasToolResults(messages),
    seed: { model, messages },
  });

  // A turn that calls tools carries no prose unless the request pinned some.
  const text = toolCalls.length > 0 ? overrides.text : (overrides.text ?? echoFallback(prompt));
  const id = deterministicId("msg_", { model, messages, text, toolCalls });

  const content: ContentBlock[] = [
    ...thinkingBlock(request, id, prompt),
    ...(text === undefined ? [] : [{ type: "text" as const, text, citations: null }]),
    ...toolCalls.map(
      (call): ToolUseBlock => ({
        type: "tool_use",
        // This API's own prefix, distinct from the `call_` ids OpenAI mints.
        id: call.id.replace(/^call_/, "toolu_"),
        name: call.name,
        input: toInput(call),
      }),
    ),
  ];

  return {
    id,
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason: toolCalls.length > 0 ? "tool_use" : "end_turn",
    stop_sequence: null,
    usage: usageFor(
      messages,
      systemText(request.system),
      text ?? toolCalls.map((call) => call.name + call.arguments).join(""),
    ),
  };
}
