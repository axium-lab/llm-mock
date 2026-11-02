import { ApiError } from "../../../core/errors";
import { echoFallback } from "../../../core/fallback";
import { deterministicCreated, deterministicId } from "../../../core/ids";
import type { Overrides } from "../../../core/override";
import { chunkText } from "../../../core/sse";
import { approxTokens } from "../../../core/usage";
import type { Completion, CompletionChoice, CompletionChunk, CompletionRequest } from "../types";

const SYSTEM_FINGERPRINT = "fp_llm_mock";

// `prompt` is the one request field with four accepted shapes. Each entry
// becomes its own prompt; a token list is joined rather than decoded, since
// the mock has no tokenizer and the echo only needs to be deterministic.
export function normalizePrompts(prompt: CompletionRequest["prompt"]): string[] {
  if (prompt === undefined || prompt === null) return [""];
  if (typeof prompt === "string") return [prompt];
  if (Array.isArray(prompt)) {
    if (prompt.length === 0) return [""];
    if (prompt.every((item) => typeof item === "number")) return [prompt.join(" ")];
    return prompt.map((item) => {
      if (typeof item === "string") return item;
      if (Array.isArray(item)) return item.join(" ");
      return JSON.stringify(item);
    });
  }
  throw new ApiError(400, "'prompt' must be a string, an array of strings, or an array of tokens.", null, "prompt");
}

export function buildCompletion(body: CompletionRequest, overrides: Overrides = {}): Completion {
  const prompts = normalizePrompts(body.prompt);
  const n = body.n ?? 1;

  // `n` choices per prompt, numbered straight through: the index is what ties
  // a choice back to its prompt.
  const choices: CompletionChoice[] = prompts.flatMap((prompt, promptIndex) =>
    Array.from({ length: n }, (_, alternative): CompletionChoice => {
      const reply = overrides.text ?? echoFallback(prompt || undefined);
      return {
        text: body.echo ? prompt + reply : reply,
        index: promptIndex * n + alternative,
        logprobs: null,
        finish_reason: "stop",
      };
    }),
  );

  const id = deterministicId("cmpl-", { model: body.model, prompts, n, echo: body.echo, text: overrides.text });
  const promptTokens = prompts.reduce((sum, prompt) => sum + approxTokens(prompt), 0);
  const completionTokens = choices.reduce((sum, choice) => sum + approxTokens(choice.text), 0);
  return {
    id,
    object: "text_completion",
    created: deterministicCreated(id),
    model: body.model,
    choices,
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
    system_fingerprint: SYSTEM_FINGERPRINT,
  };
}

// Each choice streams its text in pieces, then closes with an empty piece
// carrying the finish reason; an optional usage chunk with no choices trails
// the lot when stream_options.include_usage is set.
export function buildCompletionChunks(body: CompletionRequest, overrides: Overrides = {}): CompletionChunk[] {
  const completion = buildCompletion(body, overrides);
  const base = {
    id: completion.id,
    object: "text_completion" as const,
    created: completion.created,
    model: completion.model,
    system_fingerprint: SYSTEM_FINGERPRINT,
  };

  const chunks: CompletionChunk[] = completion.choices.flatMap((choice) => [
    ...chunkText(choice.text).map(
      (text): CompletionChunk => ({
        ...base,
        choices: [{ text, index: choice.index, logprobs: null, finish_reason: null }],
      }),
    ),
    { ...base, choices: [{ text: "", index: choice.index, logprobs: null, finish_reason: choice.finish_reason }] },
  ]);

  if (body.stream_options?.include_usage) {
    chunks.push({ ...base, choices: [], usage: completion.usage });
  }
  return chunks;
}
