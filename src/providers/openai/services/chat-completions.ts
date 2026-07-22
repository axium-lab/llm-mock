import { echoFallback } from "../../../core/fallback";
import { findFixture } from "../../../core/fixtures";
import { deterministicId } from "../../../core/ids";
import { approxTokens } from "../../../core/usage";
import { chunkText } from "../../../core/sse";
import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatMessage,
  CompletionUsage,
} from "../types";

const SYSTEM_FINGERPRINT = "fp_nopenai";

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

export function resolveContent(model: string, promptText: string | undefined): string {
  const fixture = findFixture(model, promptText ?? "");
  return fixture ? fixture.response.content : echoFallback(promptText);
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

export function buildChatCompletion(body: ChatCompletionRequest): ChatCompletion {
  const content = resolveContent(body.model, lastUserText(body.messages));
  const n = body.n ?? 1;
  return {
    id: deterministicId("chatcmpl-", { model: body.model, messages: body.messages }),
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: body.model,
    choices: Array.from({ length: n }, (_, index) => ({
      index,
      message: { role: "assistant", content, refusal: null, annotations: [] },
      logprobs: null,
      finish_reason: "stop",
    })),
    usage: usageFor(body.messages, content),
    system_fingerprint: SYSTEM_FINGERPRINT,
  };
}

// Chunk sequence: role delta, content deltas, finish_reason, and an optional
// trailing usage chunk when stream_options.include_usage is set.
export function buildChatChunks(body: ChatCompletionRequest): ChatCompletionChunk[] {
  const completion = buildChatCompletion(body);
  const content = completion.choices[0]!.message.content;
  const base = {
    id: completion.id,
    object: "chat.completion.chunk" as const,
    created: completion.created,
    model: completion.model,
    system_fingerprint: SYSTEM_FINGERPRINT,
  };

  const chunks: ChatCompletionChunk[] = [
    { ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, logprobs: null, finish_reason: null }] },
    ...chunkText(content).map((piece) => ({
      ...base,
      choices: [{ index: 0, delta: { content: piece }, logprobs: null, finish_reason: null as null }],
    })),
    { ...base, choices: [{ index: 0, delta: {}, logprobs: null, finish_reason: "stop" }] },
  ];

  if (body.stream_options?.include_usage) {
    chunks.push({ ...base, choices: [], usage: completion.usage });
  }
  return chunks;
}
