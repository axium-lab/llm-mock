import { echoFallback } from "../../../core/fallback";
import { deterministicCreated, deterministicId } from "../../../core/ids";
import type { Overrides } from "../../../core/override";
import { approxTokens } from "../../../core/usage";
import { chunkText } from "../../../core/sse";
import { resolveToolCalls, type ResolvedToolCall } from "./tools";
import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatMessage,
  CompletionUsage,
  ToolCall,
} from "../types";

const SYSTEM_FINGERPRINT = "fp_llm_mock";

function contentToText(content: ChatMessage["content"]): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part.text === "string" ? part.text : ""))
      .join("");
  }
  return "";
}

export function lastUserText(messages: ChatMessage[]): string | undefined {
  const lastUser = [...messages].reverse().find((message) => message.role === "user");
  const text = lastUser ? contentToText(lastUser.content) : "";
  return text || undefined;
}

// Tool results come back as messages with role "tool", so their presence means
// a previous turn already called a tool.
function hasToolResults(messages: ChatMessage[]): boolean {
  return messages.some((message) => message.role === "tool");
}

function usageFor(messages: ChatMessage[], completionText: string): CompletionUsage {
  const promptTokens = messages.reduce((sum, message) => sum + approxTokens(contentToText(message.content)), 0);
  const completionTokens = approxTokens(completionText);
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
  };
}

function toWireToolCall(call: ResolvedToolCall): ToolCall {
  return { id: call.id, type: "function", function: { name: call.name, arguments: call.arguments } };
}

export function buildChatCompletion(body: ChatCompletionRequest, overrides: Overrides = {}): ChatCompletion {
  const toolCalls = resolveToolCalls({
    tools: body.tools,
    toolChoice: body.tool_choice,
    override: overrides.toolCalls,
    hasToolResults: hasToolResults(body.messages),
    seed: { model: body.model, messages: body.messages },
  });

  // A turn that calls tools carries no prose unless the request pinned some.
  const content =
    toolCalls.length > 0 ? (overrides.text ?? null) : (overrides.text ?? echoFallback(lastUserText(body.messages)));
  const n = body.n ?? 1;
  const id = deterministicId("chatcmpl-", { model: body.model, messages: body.messages, content, toolCalls });
  const wireToolCalls = toolCalls.map(toWireToolCall);

  return {
    id,
    object: "chat.completion",
    created: deterministicCreated(id),
    model: body.model,
    choices: Array.from({ length: n }, (_, index) => ({
      index,
      message: {
        role: "assistant" as const,
        content,
        refusal: null,
        annotations: [] as [],
        ...(wireToolCalls.length > 0 ? { tool_calls: wireToolCalls } : {}),
      },
      logprobs: null,
      finish_reason: (wireToolCalls.length > 0 ? "tool_calls" : "stop") as "stop" | "tool_calls",
    })),
    usage: usageFor(body.messages, (content ?? "") + JSON.stringify(wireToolCalls.map((call) => call.function))),
    system_fingerprint: SYSTEM_FINGERPRINT,
  };
}

// Chunk sequence: role delta, content deltas, tool-call deltas, finish_reason,
// and an optional trailing usage chunk when stream_options.include_usage is set.
export function buildChatChunks(body: ChatCompletionRequest, overrides: Overrides = {}): ChatCompletionChunk[] {
  const completion = buildChatCompletion(body, overrides);
  const choice = completion.choices[0]!;
  const { content, tool_calls: toolCalls } = choice.message;
  const base = {
    id: completion.id,
    object: "chat.completion.chunk" as const,
    created: completion.created,
    model: completion.model,
    system_fingerprint: SYSTEM_FINGERPRINT,
  };
  const delta = (value: ChatCompletionChunk["choices"][number]["delta"]): ChatCompletionChunk => ({
    ...base,
    choices: [{ index: 0, delta: value, logprobs: null, finish_reason: null }],
  });

  const chunks: ChatCompletionChunk[] = [delta({ role: "assistant", content: content === null ? null : "" })];
  if (content !== null) {
    chunks.push(...chunkText(content).map((piece) => delta({ content: piece })));
  }

  // Each call is opened by a chunk carrying its id and name, then its arguments
  // arrive piecewise; `index` is what ties the pieces back together.
  toolCalls?.forEach((call, index) => {
    chunks.push(
      delta({ tool_calls: [{ index, id: call.id, type: "function", function: { name: call.function.name, arguments: "" } }] }),
    );
    for (const piece of chunkText(call.function.arguments)) {
      chunks.push(delta({ tool_calls: [{ index, function: { arguments: piece } }] }));
    }
  });

  chunks.push({
    ...base,
    choices: [{ index: 0, delta: {}, logprobs: null, finish_reason: choice.finish_reason }],
  });

  if (body.stream_options?.include_usage) {
    chunks.push({ ...base, choices: [], usage: completion.usage });
  }
  return chunks;
}
