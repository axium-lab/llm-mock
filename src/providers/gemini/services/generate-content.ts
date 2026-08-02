import { echoFallback } from "../../../core/fallback";
import { deterministicId } from "../../../core/ids";
import type { Overrides } from "../../../core/override";
import { chunkText } from "../../../core/sse";
import { resolveToolCalls, type ResolvedToolCall } from "../../../core/tools";
import { approxTokens } from "../../../core/usage";
import type {
  Candidate,
  Content,
  GenerateContentRequest,
  GenerateContentResponse,
  Part,
  UsageMetadata,
} from "../types";

// `contents` is an array of turns, but the SDK also lets callers pass a single
// turn or a bare string, and the mock accepts the same.
export function normalizeContents(contents: GenerateContentRequest["contents"]): Content[] {
  if (typeof contents === "string") return [{ role: "user", parts: [{ text: contents }] }];
  if (Array.isArray(contents)) return contents;
  return contents ? [contents] : [];
}

function partsText(parts: Part[] | undefined): string {
  return (parts ?? []).map((part) => part.text ?? "").join("");
}

// A turn with no role is a user turn, which is how single-turn requests arrive.
// Turns without prose are skipped: Gemini feeds tool results back under the
// user role too, and echoing an empty functionResponse turn would lose the
// prompt the caller actually wrote.
export function lastUserText(contents: Content[]): string | undefined {
  for (let index = contents.length - 1; index >= 0; index -= 1) {
    const content = contents[index]!;
    if ((content.role ?? "user") !== "user") continue;
    const text = partsText(content.parts);
    if (text) return text;
  }
  return undefined;
}

// Gemini feeds a tool result back as a functionResponse part, so its presence
// means a previous turn already called a tool.
function hasToolResults(contents: Content[]): boolean {
  return contents.some((content) => content.parts?.some((part) => part.functionResponse !== undefined));
}

// toolConfig is Gemini's tool_choice. Mapping it here keeps the shared resolver
// speaking one vocabulary: ANY forces a call, NONE forbids one, AUTO defers to
// the model — and this mock, having no model, then answers with prose.
function toToolChoice(request: GenerateContentRequest): unknown {
  const config = request.toolConfig?.functionCallingConfig;
  const allowed = config?.allowedFunctionNames;
  switch (config?.mode) {
    case "ANY":
      return allowed && allowed.length > 0 ? { name: allowed[0] } : "required";
    case "NONE":
      return "none";
    default:
      return "auto";
  }
}

// The wire carries `args` as an object. A pinned override may hold a string
// that is not valid JSON on purpose, so a client can exercise its own parsing
// failure; that string is passed through untouched rather than discarded.
function toArgs(call: ResolvedToolCall): unknown {
  try {
    return JSON.parse(call.arguments);
  } catch {
    return call.arguments;
  }
}

function usageFor(contents: Content[], systemText: string, outputText: string): UsageMetadata {
  const promptTokenCount =
    contents.reduce((sum, content) => sum + approxTokens(partsText(content.parts)), 0) +
    (systemText ? approxTokens(systemText) : 0);
  const candidatesTokenCount = approxTokens(outputText);
  return {
    promptTokenCount,
    candidatesTokenCount,
    totalTokenCount: promptTokenCount + candidatesTokenCount,
    promptTokensDetails: [{ modality: "TEXT", tokenCount: promptTokenCount }],
    candidatesTokensDetails: [{ modality: "TEXT", tokenCount: candidatesTokenCount }],
  };
}

function systemText(instruction: GenerateContentRequest["systemInstruction"]): string {
  if (typeof instruction === "string") return instruction;
  return partsText(instruction?.parts);
}

interface Generated {
  parts: Part[];
  usage: UsageMetadata;
  responseId: string;
  candidateCount: number;
}

function generate(model: string, request: GenerateContentRequest, overrides: Overrides): Generated {
  const contents = normalizeContents(request.contents);
  const toolCalls = resolveToolCalls({
    tools: request.tools,
    toolChoice: toToolChoice(request),
    override: overrides.toolCalls,
    hasToolResults: hasToolResults(contents),
    seed: { model, contents },
  });

  // A turn that calls tools carries no prose unless the request pinned some.
  const text = toolCalls.length > 0 ? overrides.text : (overrides.text ?? echoFallback(lastUserText(contents)));
  const parts: Part[] = [
    ...(text === undefined ? [] : [{ text }]),
    ...toolCalls.map((call) => ({ functionCall: { name: call.name, args: toArgs(call) } })),
  ];

  const responseId = deterministicId("", { model, contents, text, toolCalls }).slice(0, 16);
  return {
    parts,
    usage: usageFor(contents, systemText(request.systemInstruction), text ?? JSON.stringify(parts)),
    responseId,
    candidateCount: Math.max(1, request.generationConfig?.candidateCount ?? 1),
  };
}

// Gemini reports a function call as an ordinary STOP: unlike OpenAI there is no
// distinct finish reason for it.
const FINISH_REASON = "STOP";

export function buildGenerateContentResponse(
  model: string,
  request: GenerateContentRequest,
  overrides: Overrides = {},
): GenerateContentResponse {
  const { parts, usage, responseId, candidateCount } = generate(model, request, overrides);
  const candidates: Candidate[] = Array.from({ length: candidateCount }, (_, index) => ({
    content: { parts, role: "model" },
    finishReason: FINISH_REASON,
    index,
  }));
  return { candidates, usageMetadata: usage, modelVersion: model, responseId };
}

// Every SSE event is a whole GenerateContentResponse holding the slice produced
// so far. Text arrives in pieces; a functionCall part is never split, which is
// how the real API streams it. Only the last chunk carries finishReason and
// usageMetadata, and there is no [DONE] sentinel to close the stream.
export function buildGenerateContentChunks(
  model: string,
  request: GenerateContentRequest,
  overrides: Overrides = {},
): GenerateContentResponse[] {
  const { parts, usage, responseId } = generate(model, request, overrides);

  const pieces: Part[] = parts.flatMap((part) =>
    part.text === undefined ? [part] : chunkText(part.text).map((text) => ({ text })),
  );

  return pieces.map((part, index) => {
    const last = index === pieces.length - 1;
    return {
      candidates: [
        {
          content: { parts: [part], role: "model" },
          ...(last ? { finishReason: FINISH_REASON } : {}),
          index: 0,
        } as Candidate,
      ],
      ...(last ? { usageMetadata: usage } : {}),
      modelVersion: model,
      responseId,
    };
  });
}
