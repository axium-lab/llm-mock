import { echoFallback } from "../../core/fallback";
import { deterministicCreated, deterministicId } from "../../core/ids";
import type { Overrides } from "../../core/override";
import { chunkText } from "../../core/sse";
import { resolveToolCalls, type ResolvedToolCall } from "../../core/tools";
import { approxTokens } from "../../core/usage";
import type {
  CreateInteractionRequest,
  FunctionCallStep,
  Interaction,
  InteractionEvent,
  InteractionStatus,
  InteractionUsage,
  ModelOutputStep,
  Step,
  TextContent,
} from "./types";

// Only ever surfaces on a synthesized retrieval, where no request named a
// model. Both surfaces serve the same model family and both catalogs list this
// one, so it stays a constant rather than a knob neither provider would turn.
const DEFAULT_MODEL = "gemini-3.6-flash";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content.map((item) => (isRecord(item) && typeof item.text === "string" ? item.text : "")).join("");
}

// `input` is a string, a list of content items, or a list of steps. The last
// two are told apart by the item's `type`: a step names a turn ("user_input"),
// a content item names a medium ("text").
export function inputText(input: CreateInteractionRequest["input"]): string | undefined {
  if (typeof input === "string") return input || undefined;
  if (!Array.isArray(input)) return undefined;

  for (let index = input.length - 1; index >= 0; index -= 1) {
    const item = input[index];
    if (!isRecord(item)) continue;
    const text = item.type === "user_input" ? textOf(item.content) : item.type === "text" ? String(item.text ?? "") : "";
    if (text) return text;
  }
  return undefined;
}

// A function_result step is how a tool's output is fed back, so its presence
// means a previous turn already called a tool.
function hasToolResults(input: CreateInteractionRequest["input"]): boolean {
  return Array.isArray(input) && input.some((item) => isRecord(item) && item.type === "function_result");
}

// tool_choice is either a keyword or a config naming the tools the model may
// pick from; both are mapped onto the vocabulary the shared resolver speaks.
function toToolChoice(raw: unknown): unknown {
  if (raw === "any") return "required";
  if (raw === "none") return "none";
  if (isRecord(raw)) {
    const allowed = raw.allowed_tools;
    if (isRecord(allowed) && Array.isArray(allowed.tools) && typeof allowed.tools[0] === "string") {
      return allowed.mode === "none" ? "none" : { name: allowed.tools[0] };
    }
  }
  return "auto";
}

// The Interactions API declares a tool as { type: "function", name, parameters },
// which the shared normalizer already reads as a top-level declaration.
function toArguments(call: ResolvedToolCall): unknown {
  try {
    return JSON.parse(call.arguments);
  } catch {
    // A pinned override may hold deliberately malformed arguments; passing the
    // string through keeps that capability alive on this surface too.
    return call.arguments;
  }
}

function usageFor(promptText: string, outputText: string): InteractionUsage {
  const input = approxTokens(promptText);
  const output = approxTokens(outputText);
  return {
    total_tokens: input + output,
    total_input_tokens: input,
    input_tokens_by_modality: [{ modality: "text", tokens: input }],
    total_cached_tokens: 0,
    total_output_tokens: output,
    total_tool_use_tokens: 0,
    // This mock has no model and therefore never thinks.
    total_thought_tokens: 0,
  };
}

// ISO timestamps derived from the id rather than the clock, so identical
// requests stay byte-identical. Seconds precision, no fractional part, which
// is how the live API formats them.
function timestampFor(id: string): string {
  return `${new Date(deterministicCreated(id) * 1000).toISOString().slice(0, 19)}Z`;
}

function textContent(text: string): TextContent[] {
  return [{ type: "text", text }];
}

export function buildInteraction(request: CreateInteractionRequest, overrides: Overrides = {}): Interaction {
  const model = typeof request.model === "string" && request.model ? request.model : DEFAULT_MODEL;
  const prompt = inputText(request.input);
  const toolCalls = resolveToolCalls({
    tools: request.tools,
    toolChoice: toToolChoice(request.generation_config?.tool_choice),
    override: overrides.toolCalls,
    hasToolResults: hasToolResults(request.input),
    seed: { model, input: request.input },
  });

  // A turn that calls tools carries no prose unless the request pinned some.
  const output = toolCalls.length > 0 ? overrides.text : (overrides.text ?? echoFallback(prompt));
  // Live ids carry a version prefix ahead of an opaque blob.
  const id = `v1_${deterministicId("", { model, input: request.input, output, toolCalls }).slice(0, 20)}`;

  // No user_input step: the live API reports only what the model produced, and
  // echoing the prompt back is what the `include_input` flag on a retrieval is
  // for. Skipping it also keeps `output_text` resolving off the last steps.
  const steps: Step[] = [
    ...(output === undefined ? [] : [{ type: "model_output" as const, content: textContent(output) }]),
    ...toolCalls.map(
      (call): FunctionCallStep => ({
        type: "function_call",
        id: call.id,
        name: call.name,
        arguments: toArguments(call),
      }),
    ),
  ];

  return assemble({
    id,
    model,
    status: "completed",
    steps,
    usage: usageFor(
      (prompt ?? "") + (request.system_instruction ?? ""),
      output ?? toolCalls.map((call) => call.name + call.arguments).join(""),
    ),
  });
}

// Stateless stand-in for GET /interactions/{id}: there is no store to look the
// id up in, so any id yields the same deterministic, well-formed interaction.
export function buildSyntheticInteraction(id: string, status: InteractionStatus = "completed"): Interaction {
  const text = `Echo interaction ${id}`;
  return assemble({
    id,
    model: DEFAULT_MODEL,
    status,
    steps: [{ type: "model_output", content: textContent(text) }],
    usage: usageFor("", text),
  });
}

// Field order mirrors the live response, so a diff against a recorded one
// lines up.
function assemble(params: Omit<Interaction, "created" | "updated" | "service_tier" | "object">): Interaction {
  const stamp = timestampFor(params.id);
  return {
    id: params.id,
    status: params.status,
    usage: params.usage,
    created: stamp,
    updated: stamp,
    service_tier: "standard",
    steps: params.steps,
    object: "interaction",
    model: params.model,
  };
}

// Event sequence for `stream: true`: created → per step start/delta(s)/stop →
// completed. A model_output step streams its text in pieces; a function_call
// step streams its arguments as a JSON string, which is the one place this
// surface re-encodes what it otherwise sends decoded.
export function buildInteractionEvents(interaction: Interaction): InteractionEvent[] {
  const pending: Interaction = { ...interaction, status: "in_progress", steps: [] };
  const events: InteractionEvent[] = [{ event_type: "interaction.created", interaction: pending }];

  interaction.steps.forEach((step, index) => {
    if (step.type === "user_input") return;

    events.push({ event_type: "step.start", index, step: emptyShell(step) });
    for (const delta of deltasFor(step)) {
      events.push({ event_type: "step.delta", index, delta });
    }
    // step.stop announces the boundary only; the assembled step travels in the
    // final interaction, which is why the event carries no payload of its own.
    events.push({ event_type: "step.stop", index });
  });

  events.push({ event_type: "interaction.completed", interaction });
  return events;
}

// A step is announced before its content exists, so the opening event carries
// the step's identity with an empty payload.
function emptyShell(step: Step): Step {
  if (step.type === "model_output") return { type: "model_output", content: [] } satisfies ModelOutputStep;
  if (step.type === "function_call") return { ...step, arguments: {} };
  return step;
}

function deltasFor(step: Step): Record<string, unknown>[] {
  if (step.type === "model_output") {
    return chunkText(textOf(step.content)).map((text) => ({ type: "text", text }));
  }
  if (step.type === "function_call") {
    return chunkText(JSON.stringify(step.arguments)).map((piece) => ({
      type: "arguments_delta",
      arguments: piece,
    }));
  }
  return [];
}
