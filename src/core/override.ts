import type { Request } from "express";
import { ApiError } from "./errors";

// Stateless response control: each request carries its own canned response,
// so identical requests always produce identical responses — no server-side
// registration, no shared state between requests or replicas.
//
// x-llm-mock-response takes plain text (HTTP headers are latin-1, so ASCII
// is safe); the -base64 variant carries UTF-8 content that headers cannot
// transport verbatim, and wins when both are present.
export function responseOverride(req: Request): string | undefined {
  const encoded = req.headers["x-llm-mock-response-base64"];
  if (typeof encoded === "string") return Buffer.from(encoded, "base64").toString("utf-8");
  const plain = req.headers["x-llm-mock-response"];
  return typeof plain === "string" ? plain : undefined;
}

export interface ToolCallOverride {
  name: string;
  // Omitted arguments are synthesized from the tool's JSON Schema. Objects are
  // JSON-encoded by the mock; a string is passed through verbatim, which is how
  // a client pins malformed arguments to test its own error handling.
  arguments?: unknown;
}

// x-llm-mock-tool-calls carries the tool calls the response must contain, as a
// JSON array (a bare object is accepted as a single call). It overrides
// tool_choice, so a request can force tool calls the model would not have made.
const HEADER = "x-llm-mock-tool-calls";

export function toolCallsOverride(req: Request): ToolCallOverride[] | undefined {
  const raw = req.headers[HEADER];
  if (typeof raw !== "string") return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ApiError(400, "x-llm-mock-tool-calls must contain valid JSON.", "invalid_value", HEADER);
  }

  const items = Array.isArray(parsed) ? parsed : [parsed];
  return items.map((item) => {
    if (!item || typeof item !== "object" || typeof (item as ToolCallOverride).name !== "string") {
      throw new ApiError(
        400,
        `Each entry of ${HEADER} must be an object with a string 'name'.`,
        "invalid_value",
        HEADER,
      );
    }
    const { name, arguments: args } = item as ToolCallOverride;
    return { name, arguments: args };
  });
}

export interface Overrides {
  text?: string;
  toolCalls?: ToolCallOverride[];
}

// Everything a single request can pin about its own response.
export function requestOverrides(req: Request): Overrides {
  return { text: responseOverride(req), toolCalls: toolCallsOverride(req) };
}
