import { deterministicId } from "../../../core/ids";
import type { ToolCallOverride } from "../../../core/override";

// Shared tool-calling logic for both Chat Completions and the Responses API.
// The two endpoints disagree on where a tool's name lives and on how a tool
// result is fed back, so each one normalizes its own shapes and then reuses
// everything below.

export interface ResolvedToolCall {
  id: string;
  name: string;
  // Always a JSON string, matching the wire format of both APIs.
  arguments: string;
}

interface ToolSpec {
  name: string;
  parameters?: unknown;
}

type ToolChoice = { mode: "auto" | "none" | "required" } | { mode: "named"; name: string };

// Chat Completions nests the definition under `function`; the Responses API
// keeps `name`/`parameters` at the top level. Both are accepted.
export function normalizeTools(tools: unknown): ToolSpec[] {
  if (!Array.isArray(tools)) return [];
  return tools.flatMap((tool) => {
    if (!tool || typeof tool !== "object") return [];
    const record = tool as Record<string, unknown>;
    const nested = record.function as Record<string, unknown> | undefined;
    const source = nested && typeof nested === "object" ? nested : record;
    const name = source.name;
    return typeof name === "string" ? [{ name, parameters: source.parameters }] : [];
  });
}

// tool_choice is either a keyword or an object naming one function, again with
// the name nested (Chat Completions) or top level (Responses).
function parseToolChoice(raw: unknown): ToolChoice {
  if (raw === "none" || raw === "required" || raw === "auto") return { mode: raw };
  if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    const nested = record.function as Record<string, unknown> | undefined;
    const name = nested && typeof nested === "object" ? nested.name : record.name;
    if (typeof name === "string") return { mode: "named", name };
  }
  return { mode: "auto" };
}

// Placeholder value for one schema property. `default` and `enum` come from the
// schema itself, so a tool that constrains its inputs gets valid ones.
function synthesizeValue(schema: unknown): unknown {
  if (!schema || typeof schema !== "object") return null;
  const record = schema as Record<string, unknown>;
  if (record.default !== undefined) return record.default;
  if (Array.isArray(record.enum) && record.enum.length > 0) return record.enum[0];

  const type = Array.isArray(record.type) ? record.type[0] : record.type;
  switch (type) {
    case "string":
      return "mock";
    case "number":
    case "integer":
      return 0;
    case "boolean":
      return false;
    case "array":
      return [];
    case "object":
      return synthesizeArguments(record);
    default:
      return null;
  }
}

// Builds an argument object from a tool's JSON Schema. Only required
// properties are filled in; a schema without `required` gets every property, so
// a client that declared its tools always sees a usable payload.
export function synthesizeArguments(parameters: unknown): Record<string, unknown> {
  if (!parameters || typeof parameters !== "object") return {};
  const properties = (parameters as Record<string, unknown>).properties;
  if (!properties || typeof properties !== "object") return {};

  const required = (parameters as Record<string, unknown>).required;
  const names = Array.isArray(required)
    ? required.filter((name): name is string => typeof name === "string")
    : Object.keys(properties);

  const args: Record<string, unknown> = {};
  for (const name of names) {
    args[name] = synthesizeValue((properties as Record<string, unknown>)[name]);
  }
  return args;
}

export interface ResolveOptions {
  tools: unknown;
  toolChoice: unknown;
  override: ToolCallOverride[] | undefined;
  // True once the conversation already carries a result for a previous call.
  // Without this the automatic tool_choice modes would call the same tool
  // forever and no agent loop would ever terminate.
  hasToolResults: boolean;
  // Mixed into the generated ids to keep them stable per request.
  seed: unknown;
}

// Decides which tool calls the response must contain. The header wins over
// tool_choice, so a test can force a call the model would not have made.
export function resolveToolCalls({ tools, toolChoice, override, hasToolResults, seed }: ResolveOptions): ResolvedToolCall[] {
  const specs = normalizeTools(tools);
  const requested = override ?? automaticCalls(specs, parseToolChoice(toolChoice), hasToolResults);

  return requested.map((call, index) => {
    const spec = specs.find((candidate) => candidate.name === call.name);
    const args =
      call.arguments === undefined ? synthesizeArguments(spec?.parameters) : call.arguments;
    // A string override is passed through verbatim so clients can pin exact
    // (even invalid) argument payloads.
    const encoded = typeof args === "string" ? args : JSON.stringify(args);
    return {
      id: deterministicId("call_", { seed, index, name: call.name, arguments: encoded }),
      name: call.name,
      arguments: encoded,
    };
  });
}

function automaticCalls(specs: ToolSpec[], choice: ToolChoice, hasToolResults: boolean): ToolCallOverride[] {
  if (hasToolResults || specs.length === 0) return [];
  // "auto" leaves the decision to the model, and this mock has no model: it
  // answers with text unless the request demands a call.
  if (choice.mode === "required") return [{ name: specs[0]!.name }];
  if (choice.mode === "named") {
    const spec = specs.find((candidate) => candidate.name === choice.name);
    return spec ? [{ name: spec.name }] : [];
  }
  return [];
}
